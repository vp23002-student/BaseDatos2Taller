//! Inicialización idempotente de CouchDB al arrancar el backend:
//! bases de sistema, base del taller, control de acceso por roles (RBAC),
//! usuarios, índices Mango, vistas map/reduce, catálogo y datos semilla.

use super::couch::{CouchClient, ErrorDb, Res};
use crate::application::ordenes::construir_alertas;
use crate::config::Config;
use crate::domain::modelos::OrdenServicio;
use crate::domain::reglas::CATALOGO;
use reqwest::Method;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tracing::{info, warn};

// Solo se aplica a la base del CATÁLOGO (repuestos, configuración, entradas de
// inventario), donde las escrituras son escasas. En la base operativa no se usa:
// medimos que una función JS de validación cuesta ~2.5 ms por documento en cada
// escritura; allí la validación la hace el backend en Rust.
const VALIDATE_CATALOGO: &str = r#"function (newDoc, oldDoc, userCtx, secObj) {
  var roles = userCtx.roles || [];
  if (roles.indexOf('_admin') === -1 && roles.indexOf('admin') === -1) {
    throw({ forbidden: 'Solo el rol admin puede modificar repuestos, inventario y configuración.' });
  }
  if (!newDoc._deleted && !newDoc.tipo) {
    throw({ forbidden: 'Todo documento debe incluir el campo "tipo".' });
  }
}"#;

const MAP_CONSUMO: &str = r#"function (doc) {
  if (doc.tipo === 'orden_servicio' && doc.estado_backend !== 'rechazada' && doc.repuestos_usados) {
    doc.repuestos_usados.forEach(function (r) { emit(r.repuesto_id, -Number(r.cantidad || 0)); });
  }
}"#;

const MAP_ENTRADAS: &str = r#"function (doc) {
  if (doc.tipo === 'movimiento') { emit(doc.repuesto_id, Number(doc.cantidad || 0)); }
}"#;

const MAP_POR_TIPO: &str = r#"function (doc) { if (doc.tipo) { emit(doc.tipo, 1); } }"#;

async fn esperar_couch(c: &CouchClient) {
    for intento in 1..=60 {
        match c.peticion(Method::GET, &c.url_servidor("_up"), None).await {
            Ok((e, _)) if e.is_success() => {
                info!("CouchDB disponible");
                return;
            }
            _ => {
                warn!("Esperando CouchDB (intento {intento}/60)...");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
    panic!("CouchDB no respondió a tiempo");
}

async fn crear_db(c: &CouchClient, nombre: &str) -> Res<()> {
    let (e, v) = c.peticion(Method::PUT, &c.url_servidor(nombre), None).await?;
    if e.is_success() || e.as_u16() == 412 {
        Ok(())
    } else {
        Err(ErrorDb::Otro(format!("no se pudo crear {nombre}: {e} {v}")))
    }
}

pub async fn inicializar(c: &CouchClient, cat: &CouchClient, cfg: &Config) -> Res<()> {
    esperar_couch(c).await;
    for sistema in ["_users", "_replicator", &c.db, &cat.db] {
        crear_db(c, sistema).await?;
    }

    // RBAC: solo los roles 'mecanico' y 'admin' pueden acceder a las bases del taller.
    let seguridad = json!({
        "admins":  { "names": [], "roles": ["admin"] },
        "members": { "names": [], "roles": ["mecanico", "admin"] }
    });
    c.peticion(Method::PUT, &c.url_db("_security"), Some(&seguridad)).await?;
    cat.peticion(Method::PUT, &cat.url_db("_security"), Some(&seguridad)).await?;

    for (usuario, clave, rol) in &cfg.usuarios_iniciales {
        let id = format!("org.couchdb.user:{usuario}");
        let url = c.url_servidor(&format!("_users/{}", urlencoding::encode(&id)));
        let (e, _) = c.peticion(Method::GET, &url, None).await?;
        if e.as_u16() == 404 {
            let doc = json!({ "name": usuario, "password": clave, "roles": [rol], "type": "user" });
            c.peticion(Method::PUT, &url, Some(&doc)).await?;
            info!("Usuario creado: {usuario} (rol {rol})");
        }
    }

    // Índices Mango optimizados para las consultas del sistema
    let indices = [
        ("idx-tipo", json!(["tipo"])),
        ("idx-tipo-placa", json!(["tipo", "placa"])),
        ("idx-tipo-vehiculo-fecha", json!(["tipo", "vehiculo_id", "fecha"])),
        ("idx-tipo-codigo", json!(["tipo", "codigo_barras"])),
        ("idx-tipo-fecha-programada", json!(["tipo", "fecha_programada"])),
    ];
    for (nombre, campos) in indices {
        let cuerpo = json!({ "index": { "fields": campos }, "name": nombre, "ddoc": "indices", "type": "json" });
        c.peticion(Method::POST, &c.url_db("_index"), Some(&cuerpo)).await?;
    }

    // Vistas map/reduce de la base operativa (sin validate_doc_update: escrituras rápidas)
    let ddoc = json!({
        "_id": "_design/taller",
        "language": "javascript",
        "views": {
            "consumo": { "map": MAP_CONSUMO, "reduce": "_sum" },
            "por_tipo": { "map": MAP_POR_TIPO, "reduce": "_count" }
        }
    });
    c.upsert("_design/taller", ddoc).await?;

    // Base de catálogo: solo el rol admin escribe (validación en el servidor)
    let ddoc_cat = json!({
        "_id": "_design/catalogo",
        "language": "javascript",
        "validate_doc_update": VALIDATE_CATALOGO,
        "views": { "entradas": { "map": MAP_ENTRADAS, "reduce": "_sum" } }
    });
    cat.upsert("_design/catalogo", ddoc_cat).await?;
    cat.peticion(Method::POST, &cat.url_db("_index"),
        Some(&json!({ "index": { "fields": ["tipo"] }, "name": "idx-tipo", "ddoc": "indices", "type": "json" }))).await?;

    let catalogo = json!({
        "_id": "config:catalogo_servicios", "tipo": "config",
        "servicios": CATALOGO,
        "nota": "Generado por el backend en Rust. Las tabletas lo leen sin conexión."
    });
    cat.upsert("config:catalogo_servicios", catalogo).await?;

    if cfg.sembrar_demo {
        sembrar(c, cat, &cfg.ruta_semilla).await?;
    }
    info!("Base de datos '{}' inicializada", c.db);
    Ok(())
}

async fn sembrar(c: &CouchClient, cat: &CouchClient, ruta: &str) -> Res<()> {
    let existentes = c.buscar(json!({ "tipo": "cliente" }), 1).await?;
    if !existentes.is_empty() {
        info!("Datos semilla ya presentes; se omite la siembra");
        return Ok(());
    }
    let texto = match std::fs::read_to_string(ruta) {
        Ok(t) => t,
        Err(e) => {
            warn!("No se encontró la semilla en {ruta}: {e}");
            return Ok(());
        }
    };
    let semilla: Value = serde_json::from_str(&texto).map_err(|e| ErrorDb::Otro(e.to_string()))?;
    let mut docs: Vec<Value> = vec![];
    if let Some(arr) = semilla["repuestos"].as_array() {
        cat.guardar_lote(arr).await?;
    }
    for clave in ["clientes", "vehiculos"] {
        if let Some(arr) = semilla[clave].as_array() {
            docs.extend(arr.iter().cloned());
        }
    }
    let vehiculos: HashMap<String, Value> = semilla["vehiculos"]
        .as_array()
        .map(|a| a.iter().map(|v| (v["_id"].as_str().unwrap_or("").to_string(), v.clone())).collect())
        .unwrap_or_default();
    let ahora = chrono::Utc::now().to_rfc3339();
    for o in semilla["ordenes_historicas"].as_array().cloned().unwrap_or_default() {
        let mut orden: OrdenServicio = match serde_json::from_value(o) {
            Ok(x) => x,
            Err(_) => continue,
        };
        orden.estado_backend = Some("procesada".into());
        if let Some(v) = vehiculos.get(&orden.vehiculo_id) {
            docs.extend(construir_alertas(&orden, v, &ahora).into_iter().map(|a| json!(a)));
        }
        docs.push(json!(orden));
    }
    for trozo in docs.chunks(500) {
        c.guardar_lote(trozo).await?;
    }
    info!("Semilla cargada: {} documentos", docs.len());
    Ok(())
}
