//! TallerSync — backend exclusivo en Rust.
//!
//! Capas (Clean Architecture):
//!   domain/          entidades y reglas puras (validación, cálculo de próximas revisiones)
//!   application/     casos de uso (registrar órdenes, procesar replicadas, consultas)
//!   infrastructure/  cliente HTTP de CouchDB y aprovisionamiento de la base
//!   interfaces/      API REST (Axum), autenticación y telemetría

mod application;
mod config;
mod domain;
mod infrastructure;
mod interfaces;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "taller_backend=info".into()),
        )
        .init();

    let cfg = Arc::new(config::Config::desde_entorno());
    let couch = infrastructure::couch::CouchClient::nuevo(
        &cfg.couch_url,
        &cfg.couch_db,
        &cfg.couch_admin_user,
        &cfg.couch_admin_pass,
    );

    let catalogo = couch.con_db(&cfg.couch_db_catalogo);
    if let Err(e) = infrastructure::setup::inicializar(&couch, &catalogo, &cfg).await {
        panic!("No se pudo inicializar CouchDB: {e}");
    }

    let tele = Arc::new(interfaces::telemetria::Telemetria::nueva());
    tokio::spawn(application::listener::ejecutar(couch.clone(), tele.clone()));

    let escritor = infrastructure::escritor::EscritorLotes::iniciar(couch.clone());
    let estado = interfaces::http::Estado {
        couch,
        catalogo,
        escritor,
        tele,
        cfg: cfg.clone(),
        cache_auth: Arc::new(RwLock::new(HashMap::new())),
    };
    let app = interfaces::http::rutas(estado);
    let dir = format!("0.0.0.0:{}", cfg.puerto);
    let listener = tokio::net::TcpListener::bind(&dir).await.expect("puerto");
    info!("API escuchando en http://{dir}");
    axum::serve(listener, app).await.expect("servidor");
}
