//! Reglas de mantenimiento preventivo: cada servicio tiene un intervalo por
//! kilometraje y/o por tiempo. La próxima revisión es lo que ocurra PRIMERO.

use chrono::{Duration, Months, NaiveDate};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct ReglaMantenimiento {
    pub tipo: &'static str,
    pub nombre: &'static str,
    pub intervalo_km: Option<u64>,
    pub intervalo_meses: Option<u32>,
    pub precio_mano_obra: f64,
}

pub const CATALOGO: &[ReglaMantenimiento] = &[
    ReglaMantenimiento { tipo: "cambio_aceite", nombre: "Cambio de aceite y filtro", intervalo_km: Some(5_000), intervalo_meses: Some(3), precio_mano_obra: 15.0 },
    ReglaMantenimiento { tipo: "filtro_aire", nombre: "Filtro de aire", intervalo_km: Some(10_000), intervalo_meses: Some(6), precio_mano_obra: 5.0 },
    ReglaMantenimiento { tipo: "filtro_combustible", nombre: "Filtro de combustible", intervalo_km: Some(20_000), intervalo_meses: Some(12), precio_mano_obra: 10.0 },
    ReglaMantenimiento { tipo: "pastillas_freno", nombre: "Pastillas de freno", intervalo_km: Some(20_000), intervalo_meses: Some(12), precio_mano_obra: 25.0 },
    ReglaMantenimiento { tipo: "rotacion_llantas", nombre: "Rotación de llantas", intervalo_km: Some(10_000), intervalo_meses: Some(6), precio_mano_obra: 10.0 },
    ReglaMantenimiento { tipo: "alineacion_balanceo", nombre: "Alineación y balanceo", intervalo_km: Some(10_000), intervalo_meses: Some(6), precio_mano_obra: 20.0 },
    ReglaMantenimiento { tipo: "bateria", nombre: "Batería", intervalo_km: None, intervalo_meses: Some(24), precio_mano_obra: 8.0 },
    ReglaMantenimiento { tipo: "banda_distribucion", nombre: "Banda de distribución", intervalo_km: Some(60_000), intervalo_meses: Some(48), precio_mano_obra: 80.0 },
    ReglaMantenimiento { tipo: "refrigerante", nombre: "Cambio de refrigerante", intervalo_km: Some(40_000), intervalo_meses: Some(24), precio_mano_obra: 12.0 },
    ReglaMantenimiento { tipo: "bujias", nombre: "Bujías", intervalo_km: Some(30_000), intervalo_meses: Some(24), precio_mano_obra: 15.0 },
    ReglaMantenimiento { tipo: "revision_general", nombre: "Revisión general", intervalo_km: None, intervalo_meses: Some(6), precio_mano_obra: 15.0 },
    ReglaMantenimiento { tipo: "otro", nombre: "Otro / correctivo", intervalo_km: None, intervalo_meses: None, precio_mano_obra: 0.0 },
];

pub const KM_DIARIO_DEFECTO: f64 = 40.0;

pub fn buscar_regla(tipo: &str) -> Option<&'static ReglaMantenimiento> {
    CATALOGO.iter().find(|r| r.tipo == tipo)
}

/// Acepta "YYYY-MM-DD" o un datetime RFC3339 y devuelve la fecha.
pub fn parsear_fecha(texto: &str) -> Option<NaiveDate> {
    if let Ok(d) = NaiveDate::parse_from_str(texto.get(0..10)?, "%Y-%m-%d") {
        return Some(d);
    }
    None
}

#[derive(Debug, PartialEq)]
pub struct ProximaRevision {
    pub fecha: NaiveDate,
    pub km: Option<u64>,
}

/// Calcula la próxima revisión: mínimo entre (fecha + meses) y la fecha estimada
/// en que el vehículo recorrerá `intervalo_km` según su uso diario promedio.
pub fn calcular_proxima(
    regla: &ReglaMantenimiento,
    fecha_servicio: NaiveDate,
    km_servicio: u64,
    km_diario: f64,
) -> Option<ProximaRevision> {
    let por_tiempo = regla
        .intervalo_meses
        .and_then(|m| fecha_servicio.checked_add_months(Months::new(m)));
    let km_diario = if km_diario > 0.0 { km_diario } else { KM_DIARIO_DEFECTO };
    let por_km = regla.intervalo_km.map(|km| {
        let dias = (km as f64 / km_diario).ceil() as i64;
        fecha_servicio + Duration::days(dias)
    });
    let fecha = match (por_tiempo, por_km) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return None,
    };
    Some(ProximaRevision { fecha, km: regla.intervalo_km.map(|k| km_servicio + k) })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn aceite_gana_el_tiempo_si_se_maneja_poco() {
        let r = buscar_regla("cambio_aceite").unwrap();
        let f = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
        // 10 km/día -> 5000 km en 500 días; gana el criterio de 3 meses
        let p = calcular_proxima(r, f, 50_000, 10.0).unwrap();
        assert_eq!(p.fecha, NaiveDate::from_ymd_opt(2026, 4, 10).unwrap());
        assert_eq!(p.km, Some(55_000));
    }

    #[test]
    fn aceite_gana_el_km_si_se_maneja_mucho() {
        let r = buscar_regla("cambio_aceite").unwrap();
        let f = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
        // 100 km/día -> 50 días
        let p = calcular_proxima(r, f, 50_000, 100.0).unwrap();
        assert_eq!(p.fecha, NaiveDate::from_ymd_opt(2026, 3, 1).unwrap());
    }

    #[test]
    fn servicio_correctivo_no_genera_alerta() {
        let r = buscar_regla("otro").unwrap();
        let f = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
        assert!(calcular_proxima(r, f, 1, 40.0).is_none());
    }
}
