//! Casos de uso de lectura: alertas vigentes, inventario, historial vehicular,
//! conflictos de replicación y reporte de tasa de retorno (hipótesis de negocio).

use super::{hoy, ErrorApp, ResApp};
use crate::domain::reglas::parsear_fecha;
use crate::infrastructure::couch::CouchClient;
use chrono::Duration;
use reqwest::Method;
use serde_json::{json, Value};
use std::collections::HashMap;

const SIN_LIMITE: usize = 100_000;

fn s<'a>(v: &'a Value, campo: &str) -> &'a str {
    v[campo].as_str().unwrap_or_default()
}

/// Clasifica una alerta según su fecha programada.
pub fn estado_alerta(fecha_programada: &str) -> &'static str {
    match parsear_fecha(fecha_programada) {
        Some(f) if f < hoy() => "vencida",
        Some(f) if f <= hoy() + Duration::days(15) => "proxima",
        Some(_) => "programada",
        None => "desconocida",
    }
}

/// Alertas vigentes: para cada (vehículo, servicio) solo cuenta la alerta
/// generada por la orden MÁS RECIENTE (las anteriores quedan superadas).
pub fn vigentes(alertas: Vec<Value>) -> Vec<Value> {
    let mut ultima: HashMap<(String, String), Value> = HashMap::new();
    for a in alertas {
        let clave = (s(&a, "vehiculo_id").to_string(), s(&a, "tipo_servicio").to_string());
        let reemplazar = match ultima.get(&clave) {
            Some(prev) => (s(&a, "fecha_orden"), s(&a, "orden_origen")) > (s(prev, "fecha_orden"), s(prev, "orden_origen")),
            None => true,
        };
        if reemplazar {
            ultima.insert(clave, a);
        }
    }
    let mut v: Vec<Value> = ultima.into_values().collect();
    v.sort_by(|a, b| s(a, "fecha_programada").cmp(s(b, "fecha_programada")));
    v
}

pub async fn alertas(couch: &CouchClient, filtro: &str, vehiculo_id: Option<&str>) -> ResApp<Vec<Value>> {
    let mut selector = json!({ "tipo": "alerta" });
    if let Some(v) = vehiculo_id {
        selector["vehiculo_id"] = json!(v);
    }
    let todas = couch.buscar(selector, SIN_LIMITE).await?;
    let mut lista: Vec<Value> = vigentes(todas)
        .into_iter()
        .map(|mut a| {
            a["estado"] = json!(estado_alerta(s(&a, "fecha_programada")));
            a
        })
        .filter(|a| match filtro {
            "todas" => true,
            "pendientes" => s(a, "estado") != "programada",
            f => s(a, "estado") == f.trim_end_matches('s'),
        })
        .collect();

    // "join" con clientes para mostrar nombre y teléfono
    let ids: Vec<String> = lista.iter().filter_map(|a| a["cliente_id"].as_str().map(String::from)).collect();
    let clientes: HashMap<String, Value> = couch
        .obtener_varios(&ids)
        .await?
        .into_iter()
        .map(|c| (s(&c, "_id").to_string(), c))
        .collect();
    for a in lista.iter_mut() {
        if let Some(c) = a["cliente_id"].as_str().and_then(|id| clientes.get(id)) {
            a["cliente_nombre"] = c["nombre"].clone();
            a["cliente_telefono"] = c["telefono"].clone();
        }
    }
    Ok(lista)
}

pub async fn enviar_alerta(couch: &CouchClient, id: &str, prefijo_pais: &str) -> ResApp<Value> {
    let mut alerta = couch.obtener(id).await?;
    let cliente = match alerta["cliente_id"].as_str() {
        Some(cid) => couch.obtener_opcional(cid).await?.unwrap_or(Value::Null),
        None => Value::Null,
    };
    let mut tel: String = s(&cliente, "telefono").chars().filter(|c| c.is_ascii_digit()).collect();
    if tel.len() == 8 {
        tel = format!("{prefijo_pais}{tel}");
    }
    let km = alerta["km_programado"].as_u64().map(|k| format!(" o al llegar a {k} km")).unwrap_or_default();
    let mensaje = format!(
        "Hola {}, le saludamos de su taller. Su vehículo placa {} tiene programado: {} para el {}{}. ¿Desea agendar una cita?",
        s(&cliente, "nombre"), s(&alerta, "placa"), s(&alerta, "nombre_servicio"), s(&alerta, "fecha_programada"), km
    );
    let enlace = format!("https://wa.me/{tel}?text={}", urlencoding::encode(&mensaje));
    alerta["estado_envio"] = json!("enviada");
    alerta["enviada_en"] = json!(chrono::Utc::now().to_rfc3339());
    couch.guardar(id, &alerta).await?;
    Ok(json!({ "enlace": enlace, "mensaje": mensaje, "telefono": tel }))
}

/// Existencia = inicial − consumo (vista en la base operativa) + entradas (vista en el catálogo).
/// No hay un contador compartido que actualizar: cero conflictos entre tabletas.
pub async fn inventario(couch: &CouchClient, catalogo: &CouchClient) -> ResApp<Vec<Value>> {
    let repuestos = catalogo.buscar(json!({ "tipo": "repuesto" }), SIN_LIMITE).await?;
    let mut delta: HashMap<String, f64> = HashMap::new();
    for v in [
        couch.vista("taller", "consumo", "group=true").await?,
        catalogo.vista("catalogo", "entradas", "group=true").await?,
    ] {
        for r in v["rows"].as_array().cloned().unwrap_or_default() {
            *delta.entry(s(&r, "key").to_string()).or_default() += r["value"].as_f64().unwrap_or(0.0);
        }
    }
    let mut lista: Vec<Value> = repuestos
        .into_iter()
        .map(|mut r| {
            let inicial = r["existencia"].as_f64().unwrap_or(0.0);
            let actual = inicial + delta.get(s(&r, "_id")).copied().unwrap_or(0.0);
            let minimo = r["minimo_reorden"].as_f64().unwrap_or(0.0);
            r["existencia_actual"] = json!(actual);
            r["bajo_minimo"] = json!(actual <= minimo);
            r
        })
        .collect();
    lista.sort_by(|a, b| s(a, "descripcion").cmp(s(b, "descripcion")));
    Ok(lista)
}

pub async fn repuesto_por_codigo(couch: &CouchClient, catalogo: &CouchClient, codigo: &str) -> ResApp<Value> {
    inventario(couch, catalogo)
        .await?
        .into_iter()
        .find(|r| s(r, "codigo_barras") == codigo)
        .ok_or_else(|| ErrorApp::NoEncontrado(format!("no hay repuesto con código {codigo}")))
}

pub async fn entrada_inventario(couch: &CouchClient, repuesto_id: &str, cantidad: f64, usuario: &str, nota: &str) -> ResApp<Value> {
    if cantidad <= 0.0 {
        return Err(ErrorApp::Validacion(vec!["la cantidad debe ser mayor que cero".into()]));
    }
    couch.obtener(repuesto_id).await?;
    let id = format!("movimiento:{}", uuid::Uuid::new_v4().simple());
    let doc = json!({
        "_id": id, "tipo": "movimiento", "repuesto_id": repuesto_id, "cantidad": cantidad,
        "motivo": "entrada", "nota": nota, "usuario": usuario, "fecha": chrono::Utc::now().to_rfc3339()
    });
    couch.guardar(&id, &doc).await?;
    Ok(doc)
}

pub async fn buscar_vehiculos(couch: &CouchClient, placa: Option<&str>) -> ResApp<Vec<Value>> {
    let mut selector = json!({ "tipo": "vehiculo" });
    if let Some(p) = placa.filter(|p| !p.is_empty()) {
        let limpio: String = p.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        selector["placa"] = json!({ "$regex": format!("(?i){limpio}") });
    }
    Ok(couch.buscar(selector, 500).await?)
}

pub async fn detalle_vehiculo(couch: &CouchClient, id: &str) -> ResApp<Value> {
    let vehiculo = couch.obtener(id).await?;
    let cliente = match vehiculo["cliente_id"].as_str() {
        Some(c) => couch.obtener_opcional(c).await?.unwrap_or(Value::Null),
        None => Value::Null,
    };
    let mut ordenes = couch.buscar(json!({ "tipo": "orden_servicio", "vehiculo_id": id }), SIN_LIMITE).await?;
    ordenes.sort_by(|a, b| s(b, "fecha").cmp(s(a, "fecha")));
    let km_actual = ordenes
        .iter()
        .filter_map(|o| o["kilometraje"].as_f64())
        .fold(vehiculo["kilometraje_actual"].as_f64().unwrap_or(0.0), f64::max);
    let alertas = alertas(couch, "todas", Some(id)).await?;
    Ok(json!({ "vehiculo": vehiculo, "cliente": cliente, "kilometraje_actual": km_actual,
               "ordenes": ordenes, "alertas": alertas }))
}

pub async fn crear_cliente(couch: &CouchClient, mut doc: Value) -> ResApp<Value> {
    let nombre = s(&doc, "nombre").trim().to_string();
    let mut errores = vec![];
    if nombre.len() < 3 {
        errores.push("el nombre es obligatorio".into());
    }
    if doc["consentimiento_datos"].as_bool() != Some(true) {
        errores.push("se requiere el consentimiento informado del cliente para guardar sus datos".into());
    }
    if !errores.is_empty() {
        return Err(ErrorApp::Validacion(errores));
    }
    let id = format!("cliente:{}", uuid::Uuid::new_v4().simple());
    doc["_id"] = json!(id);
    doc["tipo"] = json!("cliente");
    doc["fecha_registro"] = json!(hoy().to_string());
    let rev = couch.guardar(&id, &doc).await?;
    doc["_rev"] = json!(rev);
    Ok(doc)
}

pub async fn crear_vehiculo(couch: &CouchClient, mut doc: Value) -> ResApp<Value> {
    let placa: String = s(&doc, "placa").chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    let mut errores = vec![];
    if placa.len() < 4 {
        errores.push("placa inválida".into());
    }
    match doc["cliente_id"].as_str() {
        Some(c) if couch.obtener_opcional(c).await?.is_some() => {}
        _ => errores.push("cliente_id no existe".into()),
    }
    if !errores.is_empty() {
        return Err(ErrorApp::Validacion(errores));
    }
    let id = format!("vehiculo:{placa}");
    doc["_id"] = json!(id);
    doc["tipo"] = json!("vehiculo");
    doc["placa"] = json!(placa);
    let rev = couch.guardar(&id, &doc).await?;
    doc["_rev"] = json!(rev);
    Ok(doc)
}

/// Documentos con revisiones en conflicto (ediciones concurrentes sin conexión).
pub async fn conflictos(couch: &CouchClient) -> ResApp<Vec<Value>> {
    let (_, v) = couch
        .peticion(Method::GET, &couch.url_db("_all_docs?include_docs=true&conflicts=true"), None)
        .await?;
    Ok(v["rows"]
        .as_array()
        .map(|filas| {
            filas
                .iter()
                .filter_map(|f| f.get("doc"))
                .filter(|d| d.get("_conflicts").is_some())
                .map(|d| json!({ "_id": d["_id"], "_rev": d["_rev"], "tipo": d["tipo"], "_conflicts": d["_conflicts"] }))
                .collect()
        })
        .unwrap_or_default())
}

pub async fn estadisticas(couch: &CouchClient) -> ResApp<Value> {
    let v = couch.vista("taller", "por_tipo", "group=true").await?;
    let mut mapa = serde_json::Map::new();
    for f in v["rows"].as_array().cloned().unwrap_or_default() {
        mapa.insert(s(&f, "key").to_string(), f["value"].clone());
    }
    Ok(Value::Object(mapa))
}

/// Tasa de retorno (instrumento para la hipótesis de negocio H2).
/// Unidad de análisis: cada orden que generó alertas. "Retornó" si el vehículo
/// tiene una orden posterior antes de (primera fecha programada + tolerancia).
/// Solo se evalúan órdenes cuya ventana ya cerró.
pub async fn reporte_retorno(couch: &CouchClient, tolerancia_dias: i64) -> ResApp<Value> {
    let alertas = couch.buscar(json!({ "tipo": "alerta" }), SIN_LIMITE).await?;
    let ordenes = couch
        .buscar_con(json!({ "selector": { "tipo": "orden_servicio" }, "fields": ["vehiculo_id", "fecha", "estado_backend"], "limit": SIN_LIMITE }))
        .await?;
    let mut fechas_por_vehiculo: HashMap<String, Vec<String>> = HashMap::new();
    for o in &ordenes {
        if s(o, "estado_backend") == "rechazada" {
            continue;
        }
        fechas_por_vehiculo
            .entry(s(o, "vehiculo_id").to_string())
            .or_default()
            .push(s(o, "fecha").get(0..10).unwrap_or_default().to_string());
    }
    // por orden de origen: (vehiculo, fecha_orden, primera fecha programada, notificada)
    let mut por_orden: HashMap<String, (String, String, String, bool)> = HashMap::new();
    for a in &alertas {
        let e = por_orden.entry(s(a, "orden_origen").to_string()).or_insert((
            s(a, "vehiculo_id").to_string(),
            s(a, "fecha_orden").to_string(),
            s(a, "fecha_programada").to_string(),
            false,
        ));
        if s(a, "fecha_programada") < e.2.as_str() {
            e.2 = s(a, "fecha_programada").to_string();
        }
        e.3 |= s(a, "estado_envio") == "enviada";
    }
    let (mut total, mut retornos, mut en_curso) = (0u32, 0u32, 0u32);
    let (mut notif_total, mut notif_ret, mut sin_total, mut sin_ret) = (0u32, 0u32, 0u32, 0u32);
    for (veh, fecha_orden, fecha_prog, notificada) in por_orden.values() {
        let Some(fp) = parsear_fecha(fecha_prog) else { continue };
        let limite = fp + Duration::days(tolerancia_dias);
        let retorno = fechas_por_vehiculo
            .get(veh)
            .map(|fs| fs.iter().any(|f| f.as_str() > fecha_orden.as_str() && parsear_fecha(f).is_some_and(|d| d <= limite)))
            .unwrap_or(false);
        if limite >= hoy() && !retorno {
            en_curso += 1;
            continue;
        }
        total += 1;
        retornos += retorno as u32;
        if *notificada {
            notif_total += 1;
            notif_ret += retorno as u32;
        } else {
            sin_total += 1;
            sin_ret += retorno as u32;
        }
    }
    let tasa = |r: u32, t: u32| if t == 0 { Value::Null } else { json!(((r as f64 / t as f64) * 1000.0).round() / 10.0) };
    Ok(json!({
        "definicion": "Retorno = el vehículo volvió al taller antes de la fecha programada + tolerancia",
        "tolerancia_dias": tolerancia_dias,
        "evaluables": total, "retornaron": retornos, "tasa_retorno_pct": tasa(retornos, total),
        "ventana_abierta": en_curso,
        "con_notificacion": { "total": notif_total, "retornaron": notif_ret, "tasa_pct": tasa(notif_ret, notif_total) },
        "sin_notificacion": { "total": sin_total, "retornaron": sin_ret, "tasa_pct": tasa(sin_ret, sin_total) }
    }))
}
