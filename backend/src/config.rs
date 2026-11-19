//! Configuración leída de variables de entorno (ver `.env.example`).

#[derive(Clone, Debug)]
pub struct Config {
    pub puerto: u16,
    pub couch_url: String,
    pub couch_db: String,
    pub couch_db_catalogo: String,
    pub couch_admin_user: String,
    pub couch_admin_pass: String,
    pub usuarios_iniciales: Vec<(String, String, String)>, // (usuario, clave, rol)
    pub sembrar_demo: bool,
    pub ruta_semilla: String,
    pub prefijo_whatsapp: String,
}

fn var(nombre: &str, defecto: &str) -> String {
    std::env::var(nombre).unwrap_or_else(|_| defecto.to_string())
}

impl Config {
    pub fn desde_entorno() -> Self {
        let mut usuarios = vec![];
        for (u, p, r) in [
            ("TALLER_ADMIN_USER", "TALLER_ADMIN_PASS", "admin"),
            ("MECANICO1_USER", "MECANICO1_PASS", "mecanico"),
            ("MECANICO2_USER", "MECANICO2_PASS", "mecanico"),
        ] {
            if let (Ok(user), Ok(pass)) = (std::env::var(u), std::env::var(p)) {
                if !user.is_empty() && !pass.is_empty() {
                    usuarios.push((user, pass, r.to_string()));
                }
            }
        }
        Self {
            puerto: var("PUERTO", "3000").parse().unwrap_or(3000),
            couch_url: var("COUCHDB_URL", "http://couchdb:5984"),
            couch_db: var("COUCHDB_DB", "taller"),
            couch_db_catalogo: format!("{}_catalogo", var("COUCHDB_DB", "taller")),
            couch_admin_user: var("COUCHDB_USER", "admin"),
            couch_admin_pass: var("COUCHDB_PASSWORD", "admin"),
            usuarios_iniciales: usuarios,
            sembrar_demo: var("SEMBRAR_DEMO", "true") == "true",
            ruta_semilla: var("RUTA_SEMILLA", "/datos-semilla/semilla.json"),
            prefijo_whatsapp: var("PREFIJO_WHATSAPP", "503"),
        }
    }
}
