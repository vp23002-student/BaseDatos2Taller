//! Instrumentación (Fase 4): latencia por endpoint (p50/p95/p99), conteo de
//! errores, memoria RSS, hilos del proceso y estadísticas del listener.
//! Cada respuesta incluye el encabezado `Server-Timing: app;dur=<ms>` para que
//! las pruebas de carga separen el tiempo de servidor del tiempo de red.

use axum::extract::{MatchedPath, Request, State};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const MAX_MUESTRAS: usize = 50_000;

#[derive(Default)]
struct Serie {
    conteo: u64,
    errores: u64,
    suma_us: u128,
    max_us: u64,
    muestras: VecDeque<u64>,
}

pub struct Telemetria {
    inicio: Instant,
    series: Mutex<HashMap<String, Serie>>,
    pub ordenes_procesadas: AtomicU64,
    pub ordenes_rechazadas: AtomicU64,
    pub listener_us: AtomicU64,
}

impl Telemetria {
    pub fn nueva() -> Self {
        Self {
            inicio: Instant::now(),
            series: Mutex::new(HashMap::new()),
            ordenes_procesadas: AtomicU64::new(0),
            ordenes_rechazadas: AtomicU64::new(0),
            listener_us: AtomicU64::new(0),
        }
    }

    pub fn registrar(&self, ruta: &str, us: u64, error: bool) {
        let mut mapa = self.series.lock().unwrap();
        let s = mapa.entry(ruta.to_string()).or_default();
        s.conteo += 1;
        s.errores += error as u64;
        s.suma_us += us as u128;
        s.max_us = s.max_us.max(us);
        if s.muestras.len() == MAX_MUESTRAS {
            s.muestras.pop_front();
        }
        s.muestras.push_back(us);
    }

    pub fn reiniciar(&self) {
        self.series.lock().unwrap().clear();
    }

    pub fn instantanea(&self) -> Value {
        let mapa = self.series.lock().unwrap();
        let mut endpoints = serde_json::Map::new();
        for (ruta, s) in mapa.iter() {
            let mut v: Vec<u64> = s.muestras.iter().copied().collect();
            v.sort_unstable();
            let p = |q: f64| -> f64 {
                if v.is_empty() {
                    return 0.0;
                }
                let i = ((v.len() as f64 - 1.0) * q).round() as usize;
                v[i] as f64 / 1000.0
            };
            endpoints.insert(
                ruta.clone(),
                json!({
                    "conteo": s.conteo, "errores": s.errores,
                    "promedio_ms": if s.conteo > 0 { (s.suma_us as f64 / s.conteo as f64) / 1000.0 } else { 0.0 },
                    "p50_ms": p(0.50), "p95_ms": p(0.95), "p99_ms": p(0.99),
                    "max_ms": s.max_us as f64 / 1000.0
                }),
            );
        }
        let (rss_kb, hilos) = leer_proc();
        let procesadas = self.ordenes_procesadas.load(Ordering::Relaxed);
        let rechazadas = self.ordenes_rechazadas.load(Ordering::Relaxed);
        let total = procesadas + rechazadas;
        json!({
            "servicio": "backend-rust",
            "uptime_s": self.inicio.elapsed().as_secs(),
            "memoria_rss_mb": rss_kb as f64 / 1024.0,
            "hilos": hilos,
            "endpoints": endpoints,
            "listener": {
                "ordenes_procesadas": procesadas,
                "ordenes_rechazadas": rechazadas,
                "promedio_procesamiento_ms": if total > 0 { self.listener_us.load(Ordering::Relaxed) as f64 / total as f64 / 1000.0 } else { 0.0 }
            }
        })
    }
}

/// Lee VmRSS (kB) y Threads de /proc/self/status (Linux).
fn leer_proc() -> (u64, u64) {
    let texto = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    let campo = |nombre: &str| {
        texto
            .lines()
            .find(|l| l.starts_with(nombre))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|n| n.parse().ok())
            .unwrap_or(0)
    };
    (campo("VmRSS:"), campo("Threads:"))
}

pub async fn medir(State(tele): State<Arc<Telemetria>>, ruta: Option<MatchedPath>, req: Request, next: Next) -> Response {
    let etiqueta = format!(
        "{} {}",
        req.method(),
        ruta.as_ref().map(|r| r.as_str()).unwrap_or("desconocida")
    );
    let ini = Instant::now();
    let mut resp = next.run(req).await;
    let us = ini.elapsed().as_micros() as u64;
    tele.registrar(&etiqueta, us, resp.status().is_server_error());
    if let Ok(v) = format!("app;dur={:.3}", us as f64 / 1000.0).parse() {
        resp.headers_mut().insert("server-timing", v);
    }
    resp
}
