//! Casos de uso de órdenes de servicio: registrar (vía API) y procesar las
//! órdenes que llegan replicadas desde las tabletas (vía changes feed).
//!
//! Decisión de diseño clave: las alertas son documentos NUEVOS con _id
//! determinista (`alerta:<orden>:<servicio>`), nunca se sobrescriben. Así,
//! varias tabletas sin conexión jamás generan conflictos sobre el mismo
//! documento y reprocesar una orden es idempotente.

use super::{ErrorApp, ResApp};
use crate::domain::modelos::{Alerta, OrdenServicio};
use crate::domain::reglas::{buscar_regla, calcular_proxima, parsear_fecha, KM_DIARIO_DEFECTO};
use crate::domain::validacion::validar_orden;
use crate::infrastructure::couch::{CouchClient, ErrorDb};
use crate::infrastructure::escritor::EscritorLotes;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Caché en memoria de vehículos (datos casi inmutables): evita una lectura a
/// CouchDB por cada orden. Vigencia corta para reflejar ediciones.
static CACHE_VEHICULOS: OnceLock<RwLock<HashMap<String, (Value, Instant)>>> = OnceLock::new();
const VIGENCIA_CACHE: Duration = Duration::from_secs(60);

async fn vehiculos_por_id(couch: &CouchClient, ids: Vec<String>) -> Result<HashMap<String, Value>, ErrorDb> {
    let cache = CACHE_VEHICULOS.get_or_init(|| RwLock::new(HashMap::new()));
    let mut encontrados = HashMap::new();
    let mut faltan = vec![];
    {
        let c = cache.read().await;
        for id in ids {
            match c.get(&id) {
                Some((v, t)) if t.elapsed() < VIGENCIA_CACHE => {
                    encontrados.insert(id, v.clone());
                }
                _ => faltan.push(id),
            }
        }
    }
    if !faltan.is_empty() {
        let leidos = couch.obtener_varios(&faltan).await?;
        let mut c = cache.write().await;
        for v in leidos {
            let id = v["_id"].as_str().unwrap_or_default().to_string();
            c.insert(id.clone(), (v.clone(), Instant::now()));
            encontrados.insert(id, v);
        }
    }
    Ok(encontrados)
}

pub fn construir_alertas(orden: &OrdenServicio, vehiculo: &Value, ahora: &str) -> Vec<Alerta> {
    let Some(id_orden) = orden.id.as_deref() else { return vec![] };
    let Some(fecha) = parsear_fecha(&orden.fecha) else { return vec![] };
    let km_diario = vehiculo["km_diario_estimado"].as_f64().unwrap_or(KM_DIARIO_DEFECTO);
    let sufijo = id_orden.strip_prefix("orden:").unwrap_or(id_orden);
    let mut vistos = HashSet::new();
    orden
        .servicios
        .iter()
        .filter(|s| vistos.insert(s.tipo.clone()))
        .filter_map(|s| {
            let regla = buscar_regla(&s.tipo)?;
            let prox = calcular_proxima(regla, fecha, orden.kilometraje as u64, km_diario)?;
            Some(Alerta {
                id: format!("alerta:{sufijo}:{}", s.tipo),
                rev: None,
                tipo: "alerta".into(),
                vehiculo_id: orden.vehiculo_id.clone(),
                cliente_id: orden.cliente_id.clone().or_else(|| vehiculo["cliente_id"].as_str().map(String::from)),
                placa: vehiculo["placa"].as_str().unwrap_or_default().to_string(),
                tipo_servicio: s.tipo.clone(),
                nombre_servicio: regla.nombre.to_string(),
                fecha_programada: prox.fecha.to_string(),
                km_programado: prox.km,
                estado_envio: "pendiente".into(),
                orden_origen: id_orden.to_string(),
                fecha_orden: orden.fecha.get(0..10).unwrap_or(&orden.fecha).to_string(),
                creada_en: ahora.to_string(),
                enviada_en: None,
            })
        })
        .collect()
}

fn nuevo_id_orden() -> String {
    let ts = chrono::Utc::now().format("%Y%m%d%H%M%S");
    let u = uuid::Uuid::new_v4().simple().to_string();
    format!("orden:{ts}:{}", &u[..12])
}

#[derive(Serialize)]
pub struct ResultadoOrden {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rev: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub costo_total: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub alertas: Vec<Alerta>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errores: Vec<String>,
}

/// Registra un lote de órdenes: valida, calcula totales y alertas, y escribe
/// todo en UNA sola petición `_bulk_docs` (sin bloqueos ni transacciones largas).
pub async fn registrar_lote(couch: &CouchClient, escritor: &EscritorLotes, ordenes: Vec<OrdenServicio>) -> ResApp<Vec<ResultadoOrden>> {
    let ids_veh: Vec<String> = ordenes
        .iter()
        .map(|o| o.vehiculo_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let vehiculos = vehiculos_por_id(couch, ids_veh).await?;

    let ahora = chrono::Utc::now().to_rfc3339();
    let mut resultados = vec![];
    let mut docs = vec![];
    let mut indice_resultado = HashMap::new(); // _id de la orden -> índice en resultados

    for mut o in ordenes {
        let id = o.id.clone().unwrap_or_else(nuevo_id_orden);
        o.id = Some(id.clone());
        o.rev = None;
        if let Err(errores) = validar_orden(&o) {
            resultados.push(ResultadoOrden { id, ok: false, rev: None, costo_total: None, alertas: vec![], errores });
            continue;
        }
        let Some(veh) = vehiculos.get(&o.vehiculo_id) else {
            resultados.push(ResultadoOrden {
                id, ok: false, rev: None, costo_total: None, alertas: vec![],
                errores: vec![format!("el vehículo '{}' no existe", o.vehiculo_id)],
            });
            continue;
        };
        o.cliente_id = veh["cliente_id"].as_str().map(String::from);
        o.costo_total = o.calcular_total();
        o.estado_backend = Some("procesada".into());
        o.extra.insert("procesado_en".into(), json!(ahora));
        let alertas = construir_alertas(&o, veh, &ahora);
        docs.push(json!(o));
        docs.extend(alertas.iter().map(|a| json!(a)));
        indice_resultado.insert(id.clone(), resultados.len());
        resultados.push(ResultadoOrden { id, ok: true, rev: None, costo_total: Some(o.costo_total), alertas, errores: vec![] });
    }

    if !docs.is_empty() {
        for r in escritor.escribir(docs).await? {
            let Some(id) = r["id"].as_str() else { continue };
            if let Some(&i) = indice_resultado.get(id) {
                if let Some(err) = r["error"].as_str() {
                    resultados[i].ok = false;
                    resultados[i].alertas.clear();
                    resultados[i].errores.push(format!("CouchDB: {err} {}", r["reason"].as_str().unwrap_or("")));
                } else {
                    resultados[i].rev = r["rev"].as_str().map(String::from);
                }
            }
        }
    }
    Ok(resultados)
}

pub async fn registrar_orden(couch: &CouchClient, escritor: &EscritorLotes, orden: OrdenServicio) -> ResApp<ResultadoOrden> {
    let r = registrar_lote(couch, escritor, vec![orden]).await?.pop().expect("un resultado");
    if r.ok {
        Ok(r)
    } else if r.errores.iter().any(|e| e.contains("conflict")) {
        Err(ErrorApp::Conflicto(r.errores.join("; ")))
    } else {
        Err(ErrorApp::Validacion(r.errores))
    }
}

/// Procesa una orden creada sin conexión en una tableta y replicada a CouchDB.
/// Devuelve "procesada", "rechazada" u "omitida".
pub async fn procesar_orden_remota(couch: &CouchClient, mut doc: Value) -> Result<&'static str, ErrorDb> {
    let ahora = chrono::Utc::now().to_rfc3339();
    let id = doc["_id"].as_str().unwrap_or_default().to_string();

    let resultado: Result<(OrdenServicio, Value), Vec<String>> = async {
        let orden: OrdenServicio = serde_json::from_value(doc.clone())
            .map_err(|e| vec![format!("estructura inválida: {e}")])?;
        validar_orden(&orden)?;
        let veh = couch
            .obtener_opcional(&orden.vehiculo_id)
            .await
            .map_err(|e| vec![e.to_string()])?
            .ok_or_else(|| vec![format!("el vehículo '{}' no existe", orden.vehiculo_id)])?;
        Ok::<_, Vec<String>>((orden, veh))
    }
    .await;

    let estado = match resultado {
        Ok((mut orden, veh)) => {
            orden.cliente_id = orden.cliente_id.or_else(|| veh["cliente_id"].as_str().map(String::from));
            let alertas: Vec<Value> = construir_alertas(&orden, &veh, &ahora).into_iter().map(|a| json!(a)).collect();
            // _id determinista: si ya existían (reproceso), CouchDB devuelve conflicto y se ignora.
            couch.guardar_lote(&alertas).await?;
            let total = orden.calcular_total();
            if (total - orden.costo_total).abs() > 0.009 {
                doc["costo_total_cliente"] = json!(orden.costo_total);
            }
            doc["costo_total"] = json!(total);
            doc["cliente_id"] = json!(orden.cliente_id);
            doc["estado_backend"] = json!("procesada");
            "procesada"
        }
        Err(errores) => {
            doc["estado_backend"] = json!("rechazada");
            doc["errores"] = json!(errores);
            "rechazada"
        }
    };
    doc["procesado_en"] = json!(ahora);
    match couch.guardar(&id, &doc).await {
        Ok(_) => Ok(estado),
        // La tableta editó la orden mientras se procesaba: llegará otra vez por el changes feed.
        Err(ErrorDb::Conflicto) => Ok("omitida"),
        Err(e) => Err(e),
    }
}
