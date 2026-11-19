#!/usr/bin/env python3
"""
Datos de DEMOSTRACIÓN pequeños para la clase. Las fechas se calculan desde HOY para que el
cambio de aceite (cada 5 000 km) de cada carro caiga justo en:

  * HOY            -> P900037 (Ana Prueba, Corolla)  <- el que se atiende en la demo
                      P900074 (Luis Demo, Frontier)
  * MAÑANA         -> P900111, P900148
  * PASADO MAÑANA  -> P900185, P900222
  * VENCIDO        -> P900259 (hace 5 días)
  * AL DÍA         -> P900296 (vino hace un mes)
  * SIN HISTORIAL  -> P900333 (para registrar su primera orden)

y 1 repuesto bajo mínimo (plumillas). 100 % sintéticos.
Uso: python3 datos-semilla/generar_semilla_demo.py  ->  datos-semilla/semilla_demo.json
"""
import json
from datetime import date, timedelta
from pathlib import Path

HOY = date.today()

CLIENTES = [
    ("Ana Prueba", "+503 7012-3401"), ("Luis Demo", "+503 7012-3402"), ("Carla Ejemplo", "+503 7012-3403"),
    ("José Ficticio", "+503 7012-3404"), ("María Muestra", "+503 7012-3405"), ("Pedro Sintético", "+503 7012-3406"),
    ("Sofía Anónimo", "+503 7012-3407"), ("Carlos Ensayo", "+503 7012-3408"),
]

# (cliente#, marca, modelo, año, km actual, el cambio de aceite vence en N días; None = sin historial)
VEHICULOS = [
    (1, "Toyota", "Corolla", 2015, 98_500, 0),
    (2, "Nissan", "Frontier", 2018, 142_300, 0),
    (3, "Mazda", "3", 2016, 87_900, 1),
    (4, "Hyundai", "Tucson", 2019, 65_200, 1),
    (5, "Kia", "Rio", 2020, 41_800, 2),
    (6, "Honda", "Civic", 2014, 156_000, 2),
    (7, "Toyota", "Hilux", 2021, 73_400, -5),
    (8, "Isuzu", "D-Max", 2019, 98_100, 60),
    (2, "Toyota", "Yaris", 2017, 77_000, None),
]

REPUESTOS = [
    ("7501000000011", "Aceite motor 10W-30 (galón)", 30, 10, "Lubricantes del Occidente", 22.50),
    ("7501000000035", "Filtro de aceite", 25, 8, "Repuestos Santa Ana", 6.75),
    ("7501000000059", "Filtro de aire", 12, 4, "Repuestos Santa Ana", 11.00),
    ("7501000000073", "Pastillas de freno delanteras", 10, 4, "Frenos y Más", 32.00),
    ("7501000000097", "Batería 12V 45Ah", 5, 2, "Baterías El Salvador", 89.00),
    ("7501000000134", "Juego de bujías (4)", 8, 3, "Distribuidora Automotriz", 24.00),
    ("7501000000158", "Plumillas limpiaparabrisas (par)", 2, 4, "Repuestos Santa Ana", 12.00),
]


# Uso de 62.5 km/día: 5 000 km se recorren en exactamente 80 días, antes que los 3 meses,
# así el backend en Rust programa el próximo cambio de aceite a "última visita + 80 días".
KM_DIA = 62.5
DIAS_ACEITE = 80


def placa(i: int) -> str:
    return f"P{900000 + i * 37:06d}"


clientes = [{
    "_id": f"cliente:{i:04d}", "tipo": "cliente", "nombre": n, "telefono": t,
    "consentimiento_datos": True, "fecha_registro": (HOY - timedelta(days=200 + i * 7)).isoformat(),
} for i, (n, t) in enumerate(CLIENTES, 1)]

repuestos = [{
    "_id": f"repuesto:{c}", "tipo": "repuesto", "codigo_barras": c, "descripcion": d, "existencia": e,
    "minimo_reorden": m, "proveedor": p, "precio": pr,
} for c, d, e, m, p, pr in REPUESTOS]
rep = {r["codigo_barras"]: r for r in repuestos}


def usado(codigo, cantidad=1):
    r = rep[codigo]
    return {"repuesto_id": r["_id"], "codigo_barras": codigo, "descripcion": r["descripcion"],
            "cantidad": cantidad, "precio_unitario": r["precio"]}


vehiculos, ordenes = [], []
for n, (cli, marca, modelo, anio, km, vence) in enumerate(VEHICULOS, 1):
    p = placa(n)
    vid = f"vehiculo:{p}"
    vehiculos.append({"_id": vid, "tipo": "vehiculo", "cliente_id": f"cliente:{cli:04d}", "placa": p,
                      "marca": marca, "modelo": modelo, "anio": anio,
                      "kilometraje_actual": km, "km_diario_estimado": KM_DIA})
    if vence is None:
        continue
    ultima = HOY + timedelta(days=vence - DIAS_ACEITE)
    km_visita = int(km - (HOY - ultima).days * KM_DIA)
    usados = [usado("7501000000011", 2), usado("7501000000035")]
    serv = [{"tipo": "cambio_aceite", "descripcion": "", "costo": 15}]
    total = 15 + sum(u["cantidad"] * u["precio_unitario"] for u in usados)
    ordenes.append({
        "_id": f"orden:semilla:{len(ordenes) + 1:05d}", "tipo": "orden_servicio", "vehiculo_id": vid,
        "cliente_id": f"cliente:{cli:04d}", "fecha": ultima.isoformat(),
        "kilometraje": km_visita, "servicios": serv, "repuestos_usados": usados,
        "mecanico": "mecanico1", "costo_total": round(total, 2),
        "estado": "completada", "dispositivo": "semilla",
    })

# la existencia inicial cubre lo ya consumido en el historial
for o in ordenes:
    for u in o["repuestos_usados"]:
        rep[u["codigo_barras"]]["existencia"] += u["cantidad"]

salida = {
    "descripcion": "Datos de DEMOSTRACIÓN (pequeños, sintéticos y anonimizados).",
    "generado_para": HOY.isoformat(),
    "clientes": clientes, "vehiculos": vehiculos, "repuestos": repuestos, "ordenes_historicas": ordenes,
}
ruta = Path(__file__).with_name("semilla_demo.json")
ruta.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"OK {ruta.name}: {len(clientes)} clientes, {len(vehiculos)} vehículos, "
      f"{len(repuestos)} repuestos, {len(ordenes)} órdenes (fechas relativas a {HOY})")
