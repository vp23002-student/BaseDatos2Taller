//! Capa de APLICACIÓN (casos de uso): orquesta dominio + infraestructura.

pub mod consultas;
pub mod listener;
pub mod ordenes;

use crate::infrastructure::couch::ErrorDb;

#[derive(Debug)]
pub enum ErrorApp {
    Validacion(Vec<String>),
    NoEncontrado(String),
    Conflicto(String),
    Prohibido(String),
    Db(ErrorDb),
}

impl From<ErrorDb> for ErrorApp {
    fn from(e: ErrorDb) -> Self {
        match e {
            ErrorDb::NoEncontrado => ErrorApp::NoEncontrado("documento no encontrado".into()),
            ErrorDb::Conflicto => ErrorApp::Conflicto("el documento ya existe o cambió (409)".into()),
            ErrorDb::Prohibido(m) => ErrorApp::Prohibido(m),
            otro => ErrorApp::Db(otro),
        }
    }
}

pub type ResApp<T> = Result<T, ErrorApp>;

pub fn hoy() -> chrono::NaiveDate {
    chrono::Local::now().date_naive()
}
