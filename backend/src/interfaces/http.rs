//! API REST (Axum). Las rutas protegidas exigen credenciales HTTP Basic de un
//! usuario de CouchDB; se validan contra `_session` y se guardan en caché 5 min.

use super::telemetria::{medir, Telemetria};
use crate::application::{consultas, ordenes, ErrorApp};
use crate::config::Config;
use crate::domain::modelos::OrdenServicio;
use crate::domain::reglas::CATALOGO;
use crate::domain::validacion::validar_orden;
use crate::infrastructure::couch::CouchClient;
use crate::infrastructure::escritor::EscritorLotes;
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct Estado {
    pub couch: CouchClient,
    pub catalogo: CouchClient,
    pub escritor: EscritorLotes,
    pub tele: Arc<Telemetria>,
    pub cfg: Arc<Config>,
    pub cache_auth: Arc<RwLock<HashMap<String, (Usuario, Instant)>>>,
}

#[derive(Clone, Debug)]
pub struct Usuario {
    pub nombre: String,
    pub roles: Vec<String>,
}

impl Usuario {
    fn es_admin(&self) -> bool {
        self.roles.iter().any(|r| r == "admin" || r == "_admin")
    }
}

impl IntoResponse for ErrorApp {
    fn into_response(self) -> Response {
        let (codigo, cuerpo) = match self {
            ErrorApp::Validacion(e) => (StatusCode::UNPROCESSABLE_ENTITY, json!({ "error": "validacion", "detalles": e })),
            ErrorApp::NoEncontrado(m) => (StatusCode::NOT_FOUND, json!({ "error": "no_encontrado", "mensaje": m })),
            ErrorApp::Conflicto(m) => (StatusCode::CONFLICT, json!({ "error": "conflicto", "mensaje": m })),
            ErrorApp::Prohibido(m) => (StatusCode::FORBIDDEN, json!({ "error": "prohibido", "mensaje": m })),
            ErrorApp::Db(e) => (StatusCode::BAD_GATEWAY, json!({ "error": "base_de_datos", "mensaje": e.to_string() })),
        };
        (codigo, Json(cuerpo)).into_response()
    }
}

type R<T> = Result<Json<T>, ErrorApp>;

async fn autenticar(State(st): State<Estado>, headers: HeaderMap, mut req: Request, next: Next) -> Response {
    let Some(auth) = headers.get("authorization").and_then(|h| h.to_str().ok()).map(String::from) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "se requieren credenciales (HTTP Basic)" }))).into_response();
    };
    let en_cache = st
        .cache_auth
        .read()
        .await
        .get(&auth)
        .filter(|(_, t)| t.elapsed() < Duration::from_secs(300))
        .map(|(u, _)| u.clone());
    let usuario = match en_cache {
        Some(u) => u,
        None => match st.couch.verificar_usuario(&auth).await {
            Ok(Some((nombre, roles))) => {
                let u = Usuario { nombre, roles };
                st.cache_auth.write().await.insert(auth, (u.clone(), Instant::now()));
                u
            }
            _ => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "credenciales inválidas" }))).into_response(),
        },
    };
    req.extensions_mut().insert(usuario);
    next.run(req).await
}

// ---------- handlers ----------

async fn salud(State(st): State<Estado>) -> Json<Value> {
    let couch_ok = st.couch.obtener_opcional("_design/taller").await.map(|d| d.is_some()).unwrap_or(false);
    Json(json!({ "estado": "ok", "couchdb": couch_ok, "version": env!("CARGO_PKG_VERSION") }))
}

async fn metricas(State(st): State<Estado>) -> Json<Value> {
    let mut m = st.tele.instantanea();
    let lotes = st.escritor.lotes.load(std::sync::atomic::Ordering::Relaxed);
    let docs = st.escritor.docs.load(std::sync::atomic::Ordering::Relaxed);
    m["escritor_lotes"] = json!({ "lotes_bulk_docs": lotes, "documentos": docs,
        "docs_por_lote": if lotes > 0 { docs as f64 / lotes as f64 } else { 0.0 } });
    Json(m)
}

async fn reiniciar_metricas(State(st): State<Estado>) -> Json<Value> {
    st.tele.reiniciar();
    Json(json!({ "ok": true }))
}

async fn catalogo_servicios() -> Json<Value> {
    Json(json!(CATALOGO))
}

async fn crear_orden(State(st): State<Estado>, Extension(u): Extension<Usuario>, Json(mut o): Json<OrdenServicio>) -> Result<(StatusCode, Json<Value>), ErrorApp> {
    if o.mecanico.is_empty() {
        o.mecanico = u.nombre.clone();
    }
    let r = ordenes::registrar_orden(&st.couch, &st.escritor, o).await?;
    Ok((StatusCode::CREATED, Json(json!(r))))
}

async fn crear_lote(State(st): State<Estado>, Json(lote): Json<Vec<OrdenServicio>>) -> R<Value> {
    if lote.len() > 1000 {
        return Err(ErrorApp::Validacion(vec!["máximo 1000 órdenes por lote".into()]));
    }
    let r = ordenes::registrar_lote(&st.couch, &st.escritor, lote).await?;
    let ok = r.iter().filter(|x| x.ok).count();
    Ok(Json(json!({ "recibidas": r.len(), "aceptadas": ok, "resultados": r })))
}

async fn validar(Json(o): Json<OrdenServicio>) -> Json<Value> {
    match validar_orden(&o) {
        Ok(()) => Json(json!({ "valida": true, "costo_total_calculado": o.calcular_total() })),
        Err(e) => Json(json!({ "valida": false, "errores": e })),
    }
}

#[derive(Deserialize)]
struct FiltroAlertas {
    filtro: Option<String>,
    vehiculo_id: Option<String>,
}

async fn alertas(State(st): State<Estado>, Query(q): Query<FiltroAlertas>) -> R<Vec<Value>> {
    Ok(Json(consultas::alertas(&st.couch, q.filtro.as_deref().unwrap_or("pendientes"), q.vehiculo_id.as_deref()).await?))
}

async fn enviar_alerta(State(st): State<Estado>, Path(id): Path<String>) -> R<Value> {
    Ok(Json(consultas::enviar_alerta(&st.couch, &id, &st.cfg.prefijo_whatsapp).await?))
}

async fn inventario(State(st): State<Estado>) -> R<Vec<Value>> {
    Ok(Json(consultas::inventario(&st.couch, &st.catalogo).await?))
}

async fn repuesto_codigo(State(st): State<Estado>, Path(codigo): Path<String>) -> R<Value> {
    Ok(Json(consultas::repuesto_por_codigo(&st.couch, &st.catalogo, &codigo).await?))
}

#[derive(Deserialize)]
struct Entrada {
    cantidad: f64,
    #[serde(default)]
    nota: String,
}

async fn entrada(State(st): State<Estado>, Extension(u): Extension<Usuario>, Path(id): Path<String>, Json(e): Json<Entrada>) -> R<Value> {
    if !u.es_admin() {
        return Err(ErrorApp::Prohibido("solo el rol admin registra entradas de inventario".into()));
    }
    Ok(Json(consultas::entrada_inventario(&st.catalogo, &id, e.cantidad, &u.nombre, &e.nota).await?))
}

#[derive(Deserialize)]
struct FiltroPlaca {
    placa: Option<String>,
}

async fn vehiculos(State(st): State<Estado>, Query(q): Query<FiltroPlaca>) -> R<Vec<Value>> {
    Ok(Json(consultas::buscar_vehiculos(&st.couch, q.placa.as_deref()).await?))
}

async fn detalle_vehiculo(State(st): State<Estado>, Path(id): Path<String>) -> R<Value> {
    Ok(Json(consultas::detalle_vehiculo(&st.couch, &id).await?))
}

async fn crear_vehiculo(State(st): State<Estado>, Json(doc): Json<Value>) -> Result<(StatusCode, Json<Value>), ErrorApp> {
    Ok((StatusCode::CREATED, Json(consultas::crear_vehiculo(&st.couch, doc).await?)))
}

async fn clientes(State(st): State<Estado>) -> R<Vec<Value>> {
    Ok(Json(st.couch.buscar(json!({ "tipo": "cliente" }), 100_000).await?))
}

async fn crear_cliente(State(st): State<Estado>, Json(doc): Json<Value>) -> Result<(StatusCode, Json<Value>), ErrorApp> {
    Ok((StatusCode::CREATED, Json(consultas::crear_cliente(&st.couch, doc).await?)))
}

async fn conflictos(State(st): State<Estado>) -> R<Vec<Value>> {
    Ok(Json(consultas::conflictos(&st.couch).await?))
}

#[derive(Deserialize)]
struct FiltroRetorno {
    tolerancia_dias: Option<i64>,
}

async fn reporte_retorno(State(st): State<Estado>, Query(q): Query<FiltroRetorno>) -> R<Value> {
    Ok(Json(consultas::reporte_retorno(&st.couch, q.tolerancia_dias.unwrap_or(30)).await?))
}

async fn estadisticas(State(st): State<Estado>) -> R<Value> {
    Ok(Json(consultas::estadisticas(&st.couch).await?))
}

async fn quien_soy(Extension(u): Extension<Usuario>) -> Json<Value> {
    Json(json!({ "usuario": u.nombre, "roles": u.roles }))
}

pub fn rutas(st: Estado) -> Router {
    let protegidas = Router::new()
        .route("/api/yo", get(quien_soy))
        .route("/api/clientes", get(clientes).post(crear_cliente))
        .route("/api/vehiculos", get(vehiculos).post(crear_vehiculo))
        .route("/api/vehiculos/:id", get(detalle_vehiculo))
        .route("/api/ordenes", post(crear_orden))
        .route("/api/ordenes/lote", post(crear_lote))
        .route("/api/ordenes/validar", post(validar))
        .route("/api/repuestos", get(inventario))
        .route("/api/repuestos/codigo/:codigo", get(repuesto_codigo))
        .route("/api/repuestos/:id/entrada", post(entrada))
        .route("/api/alertas", get(alertas))
        .route("/api/alertas/:id/enviar", post(enviar_alerta))
        .route("/api/conflictos", get(conflictos))
        .route("/api/reportes/retorno", get(reporte_retorno))
        .route("/api/estadisticas", get(estadisticas))
        .route_layer(from_fn_with_state(st.clone(), autenticar));

    let publicas = Router::new()
        .route("/api/salud", get(salud))
        .route("/api/metricas", get(metricas))
        .route("/api/metricas/reiniciar", post(reiniciar_metricas))
        .route("/api/catalogo", get(catalogo_servicios));

    publicas
        .merge(protegidas)
        .route_layer(from_fn_with_state(st.tele.clone(), medir))
        .with_state(st)
        .layer(CorsLayer::permissive())
}
