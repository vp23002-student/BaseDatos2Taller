//! Validación de esquema y de reglas de negocio de una orden de servicio.
//! CouchDB acepta cualquier JSON; aquí es donde Rust impone la estructura.

use super::modelos::OrdenServicio;
use super::reglas::{buscar_regla, parsear_fecha};

pub fn validar_orden(o: &OrdenServicio) -> Result<(), Vec<String>> {
    let mut errores = vec![];
    if o.tipo != "orden_servicio" {
        errores.push(format!("tipo debe ser 'orden_servicio' (llegó '{}')", o.tipo));
    }
    if !o.vehiculo_id.starts_with("vehiculo:") {
        errores.push("vehiculo_id debe tener el formato 'vehiculo:<PLACA>'".into());
    }
    if parsear_fecha(&o.fecha).is_none() {
        errores.push(format!("fecha inválida: '{}' (usar YYYY-MM-DD)", o.fecha));
    }
    if !(o.kilometraje > 0.0 && o.kilometraje < 3_000_000.0) || o.kilometraje.fract() != 0.0 {
        errores.push("kilometraje debe ser un entero entre 1 y 3 000 000".into());
    }
    if o.servicios.is_empty() {
        errores.push("la orden debe incluir al menos un servicio".into());
    }
    for s in &o.servicios {
        if buscar_regla(&s.tipo).is_none() {
            errores.push(format!("servicio desconocido: '{}'", s.tipo));
        }
        if s.costo < 0.0 {
            errores.push(format!("costo negativo en servicio '{}'", s.tipo));
        }
    }
    for r in &o.repuestos_usados {
        if !r.repuesto_id.starts_with("repuesto:") {
            errores.push(format!("repuesto_id inválido: '{}'", r.repuesto_id));
        }
        if r.cantidad <= 0.0 || r.cantidad > 1000.0 {
            errores.push(format!("cantidad inválida para '{}'", r.repuesto_id));
        }
        if r.precio_unitario < 0.0 {
            errores.push(format!("precio negativo para '{}'", r.repuesto_id));
        }
    }
    if o.mecanico.trim().is_empty() {
        errores.push("debe indicarse el mecánico responsable".into());
    }
    if errores.is_empty() {
        Ok(())
    } else {
        Err(errores)
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use serde_json::json;

    fn orden(v: serde_json::Value) -> OrdenServicio {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn orden_valida() {
        let o = orden(json!({"vehiculo_id":"vehiculo:P1","fecha":"2026-10-01","kilometraje":1000,
            "servicios":[{"tipo":"cambio_aceite","costo":15}],"mecanico":"m1"}));
        assert!(validar_orden(&o).is_ok());
    }

    #[test]
    fn orden_invalida_reporta_todos_los_errores() {
        let o = orden(json!({"vehiculo_id":"x","fecha":"ayer","kilometraje":-5,
            "servicios":[{"tipo":"magia","costo":1}],"mecanico":""}));
        let e = validar_orden(&o).unwrap_err();
        assert!(e.len() >= 5, "{e:?}");
    }
}
