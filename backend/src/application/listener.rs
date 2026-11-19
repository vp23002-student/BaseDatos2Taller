//! Escucha el *changes feed* de CouchDB: cada orden que llega replicada desde
//! una tableta (creada quizá sin conexión) se valida y genera sus alertas.
//! El punto de avance (`since`) se guarda en un documento `_local`, de modo que
//! si el backend se reinicia continúa donde se quedó sin perder órdenes.

use super::ordenes::procesar_orden_remota;
use crate::infrastructure::couch::CouchClient;
use crate::interfaces::telemetria::Telemetria;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

const CHECKPOINT: &str = "_local/listener-alertas";

pub async fn ejecutar(couch: CouchClient, tele: Arc<Telemetria>) {
    let mut desde = match couch.obtener_opcional(CHECKPOINT).await {
        Ok(Some(d)) => d["since"].as_str().unwrap_or("0").to_string(),
        _ => "0".to_string(),
    };
    info!("Listener de órdenes iniciado (since={})", &desde[..desde.len().min(20)]);
    // Filtrado en el servidor: solo órdenes que el backend aún no procesó.
    let selector = json!({ "tipo": "orden_servicio", "estado_backend": { "$exists": false } });
    loop {
        let resp = match couch.cambios(&desde, &selector).await {
            Ok(r) => r,
            Err(e) => {
                warn!("changes feed: {e}; reintento en 3 s");
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        for cambio in resp["results"].as_array().cloned().unwrap_or_default() {
            let doc = &cambio["doc"];
            if cambio["deleted"].as_bool() == Some(true) || doc.is_null() {
                continue;
            }
            if matches!(doc["estado_backend"].as_str(), Some("procesada") | Some("rechazada")) {
                continue;
            }
            let ini = Instant::now();
            match procesar_orden_remota(&couch, doc.clone()).await {
                Ok(estado) => {
                    let us = ini.elapsed().as_micros() as u64;
                    tele.listener_us.fetch_add(us, Ordering::Relaxed);
                    match estado {
                        "procesada" => tele.ordenes_procesadas.fetch_add(1, Ordering::Relaxed),
                        "rechazada" => tele.ordenes_rechazadas.fetch_add(1, Ordering::Relaxed),
                        _ => 0,
                    };
                    info!("orden {} -> {estado} ({} µs)", doc["_id"].as_str().unwrap_or("?"), us);
                }
                Err(e) => warn!("no se pudo procesar {}: {e}", doc["_id"]),
            }
        }
        if let Some(ultimo) = resp["last_seq"].as_str() {
            if ultimo != desde {
                desde = ultimo.to_string();
                let _ = couch.upsert(CHECKPOINT, json!({ "since": desde })).await;
            }
        }
    }
}
