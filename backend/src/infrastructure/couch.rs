//! Cliente HTTP asíncrono para CouchDB (API REST + Mango Queries + vistas + _changes).

use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use std::fmt;
use std::time::Duration;

#[derive(Debug)]
pub enum ErrorDb {
    NoEncontrado,
    Conflicto,
    Prohibido(String),
    Otro(String),
}

impl fmt::Display for ErrorDb {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorDb::NoEncontrado => write!(f, "documento no encontrado"),
            ErrorDb::Conflicto => write!(f, "conflicto de revisión (409)"),
            ErrorDb::Prohibido(m) => write!(f, "prohibido: {m}"),
            ErrorDb::Otro(m) => write!(f, "{m}"),
        }
    }
}

impl From<reqwest::Error> for ErrorDb {
    fn from(e: reqwest::Error) -> Self {
        ErrorDb::Otro(format!("error de transporte con CouchDB: {e}"))
    }
}

pub type Res<T> = Result<T, ErrorDb>;

#[derive(Clone)]
pub struct CouchClient {
    http: reqwest::Client,
    largo: reqwest::Client, // para long-polling del changes feed
    base: String,
    pub db: String,
    usuario: String,
    clave: String,
}

/// Codifica un _id para la URL respetando los prefijos especiales de CouchDB.
pub fn codificar_id(id: &str) -> String {
    for prefijo in ["_design/", "_local/"] {
        if let Some(resto) = id.strip_prefix(prefijo) {
            return format!("{prefijo}{}", urlencoding::encode(resto));
        }
    }
    urlencoding::encode(id).into_owned()
}

impl CouchClient {
    pub fn nuevo(base: &str, db: &str, usuario: &str, clave: &str) -> Self {
        let http = reqwest::Client::builder()
            .pool_max_idle_per_host(64)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("cliente http");
        let largo = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .expect("cliente http largo");
        Self {
            http,
            largo,
            base: base.trim_end_matches('/').to_string(),
            db: db.to_string(),
            usuario: usuario.to_string(),
            clave: clave.to_string(),
        }
    }

    /// Mismo cliente (pool de conexiones compartido) apuntando a otra base de datos.
    pub fn con_db(&self, db: &str) -> Self {
        Self { db: db.to_string(), ..self.clone() }
    }

    pub fn url_servidor(&self, ruta: &str) -> String {
        format!("{}/{}", self.base, ruta.trim_start_matches('/'))
    }

    pub fn url_db(&self, ruta: &str) -> String {
        if ruta.is_empty() {
            format!("{}/{}", self.base, self.db)
        } else {
            format!("{}/{}/{}", self.base, self.db, ruta)
        }
    }

    /// Petición genérica autenticada como administrador del servidor.
    pub async fn peticion(&self, metodo: Method, url: &str, cuerpo: Option<&Value>) -> Res<(StatusCode, Value)> {
        let mut rb = self
            .http
            .request(metodo, url)
            .basic_auth(&self.usuario, Some(&self.clave));
        if let Some(c) = cuerpo {
            rb = rb.json(c);
        }
        let resp = rb.send().await?;
        let estado = resp.status();
        let valor = resp.json::<Value>().await.unwrap_or(Value::Null);
        Ok((estado, valor))
    }

    fn mapear_error(estado: StatusCode, cuerpo: &Value) -> ErrorDb {
        match estado {
            StatusCode::NOT_FOUND => ErrorDb::NoEncontrado,
            StatusCode::CONFLICT => ErrorDb::Conflicto,
            StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED => ErrorDb::Prohibido(cuerpo.to_string()),
            _ => ErrorDb::Otro(format!("CouchDB respondió {estado}: {cuerpo}")),
        }
    }

    /// Verifica credenciales de un usuario final contra `_session` de CouchDB.
    /// Devuelve sus roles si son válidas.
    pub async fn verificar_usuario(&self, encabezado_auth: &str) -> Res<Option<(String, Vec<String>)>> {
        let resp = self
            .http
            .get(self.url_servidor("_session"))
            .header("Authorization", encabezado_auth)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Ok(None);
        }
        let v: Value = resp.json().await?;
        let ctx = &v["userCtx"];
        match ctx["name"].as_str() {
            Some(nombre) => {
                let roles = ctx["roles"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|r| r.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                Ok(Some((nombre.to_string(), roles)))
            }
            None => Ok(None),
        }
    }

    pub async fn obtener(&self, id: &str) -> Res<Value> {
        let (e, v) = self.peticion(Method::GET, &self.url_db(&codificar_id(id)), None).await?;
        if e.is_success() {
            Ok(v)
        } else {
            Err(Self::mapear_error(e, &v))
        }
    }

    pub async fn obtener_opcional(&self, id: &str) -> Res<Option<Value>> {
        match self.obtener(id).await {
            Ok(v) => Ok(Some(v)),
            Err(ErrorDb::NoEncontrado) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// PUT de un documento (debe incluir `_rev` si ya existe). Devuelve la nueva revisión.
    pub async fn guardar(&self, id: &str, doc: &Value) -> Res<String> {
        let (e, v) = self.peticion(Method::PUT, &self.url_db(&codificar_id(id)), Some(doc)).await?;
        if e.is_success() {
            Ok(v["rev"].as_str().unwrap_or_default().to_string())
        } else {
            Err(Self::mapear_error(e, &v))
        }
    }

    /// Crea o reemplaza (lee la revisión actual si existe).
    pub async fn upsert(&self, id: &str, mut doc: Value) -> Res<String> {
        if let Some(actual) = self.obtener_opcional(id).await? {
            doc["_rev"] = actual["_rev"].clone();
        }
        self.guardar(id, &doc).await
    }

    /// Escritura por lotes en una sola petición HTTP (_bulk_docs).
    pub async fn guardar_lote(&self, docs: &[Value]) -> Res<Vec<Value>> {
        let (e, v) = self
            .peticion(Method::POST, &self.url_db("_bulk_docs"), Some(&json!({ "docs": docs })))
            .await?;
        if e.is_success() {
            Ok(v.as_array().cloned().unwrap_or_default())
        } else {
            Err(Self::mapear_error(e, &v))
        }
    }

    /// Lee varios documentos por _id en una sola petición (_all_docs con keys).
    pub async fn obtener_varios(&self, ids: &[String]) -> Res<Vec<Value>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let (e, v) = self
            .peticion(
                Method::POST,
                &self.url_db("_all_docs?include_docs=true"),
                Some(&json!({ "keys": ids })),
            )
            .await?;
        if !e.is_success() {
            return Err(Self::mapear_error(e, &v));
        }
        Ok(v["rows"]
            .as_array()
            .map(|filas| filas.iter().filter_map(|f| f.get("doc")).filter(|d| d.is_object()).cloned().collect())
            .unwrap_or_default())
    }

    /// Mango Query (`_find`).
    pub async fn buscar(&self, selector: Value, limite: usize) -> Res<Vec<Value>> {
        self.buscar_con(json!({ "selector": selector, "limit": limite })).await
    }

    pub async fn buscar_con(&self, consulta: Value) -> Res<Vec<Value>> {
        let (e, v) = self.peticion(Method::POST, &self.url_db("_find"), Some(&consulta)).await?;
        if e.is_success() {
            Ok(v["docs"].as_array().cloned().unwrap_or_default())
        } else {
            Err(Self::mapear_error(e, &v))
        }
    }

    /// Consulta a una vista map/reduce.
    pub async fn vista(&self, ddoc: &str, vista: &str, parametros: &str) -> Res<Value> {
        let url = self.url_db(&format!("_design/{ddoc}/_view/{vista}?{parametros}"));
        let (e, v) = self.peticion(Method::GET, &url, None).await?;
        if e.is_success() {
            Ok(v)
        } else {
            Err(Self::mapear_error(e, &v))
        }
    }

    /// Long-polling al changes feed filtrado por selector Mango.
    pub async fn cambios(&self, desde: &str, selector: &Value) -> Res<Value> {
        let url = self.url_db(&format!(
            "_changes?feed=longpoll&include_docs=true&conflicts=true&timeout=25000&limit=500&filter=_selector&since={}",
            urlencoding::encode(desde)
        ));
        let resp = self
            .largo
            .post(url)
            .basic_auth(&self.usuario, Some(&self.clave))
            .json(&json!({ "selector": selector }))
            .send()
            .await?;
        let estado = resp.status();
        let v: Value = resp.json().await.unwrap_or(Value::Null);
        if estado.is_success() {
            Ok(v)
        } else {
            Err(Self::mapear_error(estado, &v))
        }
    }
}
