//! Entidades del modelo documental (Tabla 4 de la Fase 1).
//! `extra` (flatten) conserva cualquier campo adicional: CouchDB es sin esquema
//! y el backend no debe perder información que no conoce.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

fn tipo_orden() -> String {
    "orden_servicio".into()
}
fn estado_defecto() -> String {
    "completada".into()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServicioRealizado {
    pub tipo: String,
    #[serde(default)]
    pub descripcion: String,
    #[serde(default)]
    pub costo: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RepuestoUsado {
    pub repuesto_id: String,
    #[serde(default)]
    pub codigo_barras: String,
    #[serde(default)]
    pub descripcion: String,
    pub cantidad: f64,
    #[serde(default)]
    pub precio_unitario: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OrdenServicio {
    #[serde(rename = "_id", default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "_rev", default, skip_serializing_if = "Option::is_none")]
    pub rev: Option<String>,
    #[serde(default = "tipo_orden")]
    pub tipo: String,
    pub vehiculo_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cliente_id: Option<String>,
    pub fecha: String,
    pub kilometraje: f64,
    #[serde(default)]
    pub servicios: Vec<ServicioRealizado>,
    #[serde(default)]
    pub repuestos_usados: Vec<RepuestoUsado>,
    #[serde(default)]
    pub mecanico: String,
    #[serde(default)]
    pub costo_total: f64,
    #[serde(default = "estado_defecto")]
    pub estado: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estado_backend: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errores: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl OrdenServicio {
    /// Costo calculado en el servidor (la regla de negocio manda sobre el cliente).
    pub fn calcular_total(&self) -> f64 {
        let s: f64 = self.servicios.iter().map(|s| s.costo).sum();
        let r: f64 = self
            .repuestos_usados
            .iter()
            .map(|r| r.cantidad * r.precio_unitario)
            .sum();
        ((s + r) * 100.0).round() / 100.0
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Alerta {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "_rev", default, skip_serializing_if = "Option::is_none")]
    pub rev: Option<String>,
    pub tipo: String, // "alerta"
    pub vehiculo_id: String,
    #[serde(default)]
    pub cliente_id: Option<String>,
    #[serde(default)]
    pub placa: String,
    pub tipo_servicio: String,
    pub nombre_servicio: String,
    pub fecha_programada: String,
    pub km_programado: Option<u64>,
    pub estado_envio: String, // pendiente | enviada
    pub orden_origen: String,
    pub fecha_orden: String,
    pub creada_en: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enviada_en: Option<String>,
}
