#!/usr/bin/env python3
"""
Genera datos SINTÉTICOS y ANONIMIZADOS para la demo y los experimentos.

Ningún nombre, teléfono, placa ni VIN corresponde a una persona o vehículo
real: se construyen combinando listas genéricas con una semilla aleatoria fija
(reproducible). Esto cumple el aspecto ético de la Fase 3 (anonimización
estricta de las bases de datos de prueba).

Uso:  python3 datos-semilla/generar_semilla.py
Salida: datos-semilla/semilla.json
"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(2026)  # reproducible
HOY = date(2026, 11, 7)

NOMBRES = ["Ana", "Luis", "Carla", "José", "María", "Pedro", "Sofía", "Carlos", "Elena",
           "Miguel", "Rosa", "Jorge", "Lucía", "Mario", "Andrea", "Raúl", "Patricia",
           "Fernando", "Gabriela", "Óscar", "Claudia", "Ricardo", "Daniela", "Héctor"]
APELLIDOS = ["Prueba", "Demo", "Ejemplo", "Ficticio", "Muestra", "Sintético", "Anónimo",
             "Ensayo", "Modelo", "Simulado"]
MARCAS = {
    "Toyota": ["Corolla", "Hilux", "Yaris", "RAV4"],
    "Nissan": ["Sentra", "Frontier", "Versa", "X-Trail"],
    "Mazda": ["3", "CX-5", "BT-50"],
    "Hyundai": ["Accent", "Tucson", "Elantra"],
    "Kia": ["Rio", "Sportage", "Picanto"],
    "Honda": ["Civic", "CR-V", "Fit"],
    "Mitsubishi": ["L200", "Lancer", "Montero Sport"],
    "Isuzu": ["D-Max"],
}
REPUESTOS = [
    # codigo_barras, descripcion, existencia, minimo, proveedor, precio, servicio relacionado
    ("7501000000011", "Aceite motor 10W-30 (galón)", 40, 10, "Lubricantes del Occidente", 22.50, "cambio_aceite"),
    ("7501000000028", "Aceite motor 5W-30 sintético (galón)", 25, 8, "Lubricantes del Occidente", 34.00, "cambio_aceite"),
    ("7501000000035", "Filtro de aceite universal A", 50, 15, "Repuestos Santa Ana", 6.75, "cambio_aceite"),
    ("7501000000042", "Filtro de aceite universal B", 30, 10, "Repuestos Santa Ana", 7.25, "cambio_aceite"),
    ("7501000000059", "Filtro de aire motor", 20, 6, "Repuestos Santa Ana", 11.00, "filtro_aire"),
    ("7501000000066", "Filtro de combustible", 15, 5, "Distribuidora Automotriz", 14.50, "filtro_combustible"),
    ("7501000000073", "Pastillas de freno delanteras", 18, 6, "Frenos y Más", 32.00, "pastillas_freno"),
    ("7501000000080", "Pastillas de freno traseras", 12, 4, "Frenos y Más", 28.00, "pastillas_freno"),
    ("7501000000097", "Batería 12V 45Ah", 6, 3, "Baterías El Salvador", 89.00, "bateria"),
    ("7501000000103", "Batería 12V 60Ah", 4, 2, "Baterías El Salvador", 115.00, "bateria"),
    ("7501000000110", "Kit banda de distribución", 5, 2, "Distribuidora Automotriz", 135.00, "banda_distribucion"),
    ("7501000000127", "Refrigerante concentrado (galón)", 20, 6, "Lubricantes del Occidente", 16.00, "refrigerante"),
    ("7501000000134", "Juego de bujías (4)", 14, 5, "Distribuidora Automotriz", 24.00, "bujias"),
    ("7501000000141", "Líquido de frenos DOT4", 16, 5, "Frenos y Más", 9.50, "pastillas_freno"),
    ("7501000000158", "Plumillas limpiaparabrisas (par)", 3, 4, "Repuestos Santa Ana", 12.00, "revision_general"),
]
SERVICIOS_PRECIO = {
    "cambio_aceite": 15.0, "filtro_aire": 5.0, "filtro_combustible": 10.0,
    "pastillas_freno": 25.0, "rotacion_llantas": 10.0, "alineacion_balanceo": 20.0,
    "bateria": 8.0, "banda_distribucion": 80.0, "refrigerante": 12.0, "bujias": 15.0,
    "revision_general": 15.0,
}
MECANICOS = ["mecanico1", "mecanico2"]


def placa(i: int) -> str:
    # Formato salvadoreño de placa particular: P + 6 dígitos (ficticios, rango 9xxxxx)
    return f"P{900000 + i * 37:06d}"


def vin(i: int) -> str:
    return f"DEMO{i:05d}" + "".join(random.choice("ABCDEFGHJKLMNPRSTUVWXYZ0123456789") for _ in range(8))


clientes, vehiculos = [], []
for i in range(1, 121):
    cid = f"cliente:{i:04d}"
    nombre = f"{random.choice(NOMBRES)} {random.choice(APELLIDOS)} {i:03d}"
    clientes.append({
        "_id": cid, "tipo": "cliente", "nombre": nombre,
        "telefono": f"+503 7{random.randint(100, 999)}-{random.randint(1000, 9999)}",
        "correo": f"cliente{i:03d}@ejemplo.invalid",
        "consentimiento_datos": True,
        "fecha_registro": (HOY - timedelta(days=random.randint(200, 900))).isoformat(),
    })
    for k in range(1 if random.random() < 0.8 else 2):
        n = len(vehiculos) + 1
        marca = random.choice(list(MARCAS))
        p = placa(n)
        vehiculos.append({
            "_id": f"vehiculo:{p}", "tipo": "vehiculo", "cliente_id": cid, "placa": p,
            "marca": marca, "modelo": random.choice(MARCAS[marca]),
            "anio": random.randint(2005, 2024), "vin": vin(n),
            "kilometraje_actual": random.randint(30_000, 180_000),
            "km_diario_estimado": random.choice([25, 35, 40, 50, 70]),
        })

repuestos = [{
    "_id": f"repuesto:{c}", "tipo": "repuesto", "codigo_barras": c, "descripcion": d,
    "existencia": e, "minimo_reorden": m, "proveedor": p, "precio": pr, "servicio_relacionado": s,
} for c, d, e, m, p, pr, s in REPUESTOS]


def armar_orden(idx: int, veh: dict, fecha: date, km: int, servicios: list[str]) -> dict:
    serv = [{"tipo": s, "descripcion": "", "costo": SERVICIOS_PRECIO[s]} for s in servicios]
    usados = []
    for s in servicios:
        cand = [r for r in repuestos if r["servicio_relacionado"] == s]
        if cand:
            r = random.choice(cand)
            cant = 2 if r["codigo_barras"] in ("7501000000011", "7501000000028") else 1
            usados.append({"repuesto_id": r["_id"], "codigo_barras": r["codigo_barras"],
                           "descripcion": r["descripcion"], "cantidad": cant,
                           "precio_unitario": r["precio"]})
    total = sum(x["costo"] for x in serv) + sum(u["cantidad"] * u["precio_unitario"] for u in usados)
    return {
        "_id": f"orden:semilla:{idx:05d}", "tipo": "orden_servicio", "vehiculo_id": veh["_id"],
        "cliente_id": veh["cliente_id"], "fecha": fecha.isoformat(), "kilometraje": km,
        "servicios": serv, "repuestos_usados": usados, "mecanico": random.choice(MECANICOS),
        "costo_total": round(total, 2), "estado": "completada", "dispositivo": "semilla",
    }


# Historial: ~70 % de los vehículos tienen 1-3 visitas en los últimos 10 meses.
ordenes = []
for veh in vehiculos:
    if random.random() > 0.7:
        continue
    visitas = random.randint(1, 3)
    fecha = HOY - timedelta(days=random.randint(150, 300))
    km = veh["kilometraje_actual"] - random.randint(3000, 9000)
    for _ in range(visitas):
        if fecha > HOY:
            break
        servicios = ["cambio_aceite"] + random.sample(
            ["filtro_aire", "pastillas_freno", "rotacion_llantas", "revision_general",
             "bujias", "refrigerante", "bateria"], k=random.randint(0, 2))
        ordenes.append(armar_orden(len(ordenes) + 1, veh, fecha, km, servicios))
        dias = random.randint(60, 140)
        fecha += timedelta(days=dias)
        km += dias * veh["km_diario_estimado"]

# La existencia inicial cubre lo consumido en el historial, para que el stock
# actual quede cerca del valor de la tabla (algunos quedan bajo mínimo a propósito).
consumo = {}
for o in ordenes:
    for u in o["repuestos_usados"]:
        consumo[u["repuesto_id"]] = consumo.get(u["repuesto_id"], 0) + u["cantidad"]
for r in repuestos:
    r["existencia"] += consumo.get(r["_id"], 0)

salida = {
    "descripcion": "Datos sintéticos anonimizados para demo/experimentos (no son personas reales).",
    "generado_para": HOY.isoformat(),
    "clientes": clientes, "vehiculos": vehiculos, "repuestos": repuestos,
    "ordenes_historicas": ordenes,
}
ruta = Path(__file__).with_name("semilla.json")
ruta.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"OK {ruta}: {len(clientes)} clientes, {len(vehiculos)} vehículos, "
      f"{len(repuestos)} repuestos, {len(ordenes)} órdenes históricas")
