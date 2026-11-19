//! Escritor por lotes ("group commit") hacia CouchDB.
//!
//! CouchDB confirma cada petición de escritura en disco (fsync). Si cada orden
//! viaja en su propia petición, el fsync domina la latencia. Este componente
//! agrupa las órdenes que llegan concurrentemente (ventana de pocos ms) en UN
//! solo `_bulk_docs`, y responde a cada petición HTTP con SU resultado cuando
//! CouchDB confirmó la escritura. No se pierde durabilidad (no usa `batch=ok`).
//!
//! Es posible gracias a Tokio: miles de peticiones esperan en un canal sin
//! bloquear hilos, y el ownership de Rust garantiza que cada respuesta llega a
//! quien la pidió sin condiciones de carrera.

use super::couch::{CouchClient, ErrorDb, Res};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Semaphore};

const VENTANA: Duration = Duration::from_millis(3);
const MAX_DOCS_LOTE: usize = 600;
const ESCRITURAS_SIMULTANEAS: usize = 4;

struct Peticion {
    docs: Vec<Value>,
    respuesta: oneshot::Sender<Res<Vec<Value>>>,
}

#[derive(Clone)]
pub struct EscritorLotes {
    tx: mpsc::Sender<Peticion>,
    pub lotes: Arc<AtomicU64>,
    pub docs: Arc<AtomicU64>,
}

impl EscritorLotes {
    pub fn iniciar(couch: CouchClient) -> Self {
        let (tx, mut rx) = mpsc::channel::<Peticion>(10_000);
        let lotes = Arc::new(AtomicU64::new(0));
        let docs = Arc::new(AtomicU64::new(0));
        let (l2, d2) = (lotes.clone(), docs.clone());
        let permisos = Arc::new(Semaphore::new(ESCRITURAS_SIMULTANEAS));

        tokio::spawn(async move {
            while let Some(primera) = rx.recv().await {
                let mut grupo = vec![primera];
                let mut total = grupo[0].docs.len();
                let limite = tokio::time::Instant::now() + VENTANA;
                while total < MAX_DOCS_LOTE {
                    match tokio::time::timeout_at(limite, rx.recv()).await {
                        Ok(Some(p)) => {
                            total += p.docs.len();
                            grupo.push(p);
                        }
                        _ => break,
                    }
                }
                let permiso = permisos.clone().acquire_owned().await.expect("semáforo");
                let couch = couch.clone();
                l2.fetch_add(1, Ordering::Relaxed);
                d2.fetch_add(total as u64, Ordering::Relaxed);
                tokio::spawn(async move {
                    let _permiso = permiso;
                    let todos: Vec<Value> = grupo.iter().flat_map(|p| p.docs.iter().cloned()).collect();
                    match couch.guardar_lote(&todos).await {
                        Ok(resultados) => {
                            let mut it = resultados.into_iter();
                            for p in grupo {
                                let parte: Vec<Value> = it.by_ref().take(p.docs.len()).collect();
                                let _ = p.respuesta.send(Ok(parte));
                            }
                        }
                        Err(e) => {
                            let msg = e.to_string();
                            for p in grupo {
                                let _ = p.respuesta.send(Err(ErrorDb::Otro(msg.clone())));
                            }
                        }
                    }
                });
            }
        });
        Self { tx, lotes, docs }
    }

    /// Encola documentos y espera la confirmación de CouchDB.
    pub async fn escribir(&self, docs: Vec<Value>) -> Res<Vec<Value>> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Peticion { docs, respuesta: tx })
            .await
            .map_err(|_| ErrorDb::Otro("escritor detenido".into()))?;
        rx.await.map_err(|_| ErrorDb::Otro("escritor sin respuesta".into()))?
    }
}
