//! Capa de DOMINIO (Clean Architecture): entidades y reglas de negocio puras.
//! No conoce HTTP ni CouchDB; solo estructuras y funciones deterministas,
//! por lo que puede probarse de forma aislada (`cargo test`).

pub mod modelos;
pub mod reglas;
pub mod validacion;
