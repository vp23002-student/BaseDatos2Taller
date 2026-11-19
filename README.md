# TallerSync — Mantenimiento preventivo y repuestos para talleres mecánicos

Proyecto de **Base de Datos II** (UES – FMOcc). Sistema *offline-first* para talleres mecánicos
independientes: historial vehicular, órdenes de servicio, inventario de repuestos con escaneo de
códigos y **alertas automáticas de mantenimiento** por WhatsApp, que **funciona sin internet** en la
tableta del taller y se sincroniza cuando vuelve la conexión.

| Capa | Tecnología | Carpeta |
|---|---|---|
| Base de datos | **Apache CouchDB 3.4** (servidor) + **PouchDB** (réplica en cada tableta) | `couchdb/` |
| Backend exclusivo | **Rust** (Axum, Tokio, Reqwest, Serde) — Clean Architecture | `backend/` |
| Frontend | **TypeScript** (PWA con Vite, optimizada para tabletas) | `frontend/` |
| Arquitectura de referencia | Node.js + PostgreSQL (monolito síncrono, para comparar) | `baseline-monolito/` |
| Experimentos | k6, simulador TypeScript con `tc netem`, Python/SciPy | `experimentos/` |
| Documentos de las fases 2–6 | Markdown + Excel | `docs/` |

---

## 1. Requisitos

- Linux (probado en Debian 13) con **Docker** y **Docker Compose v2**. No hace falta instalar Rust,
  Node ni Python: todo se compila y ejecuta dentro de contenedores.
- ~3 GB libres en disco. La **primera** construcción tarda 3–6 min (compila Rust).

## 2. Arrancar la aplicación

```bash
./scripts/iniciar.sh
```

Abre **http://localhost:8080** (en una tableta de la misma red: `http://<IP-del-servidor>:8080`).

| Usuario | Contraseña | Rol |
|---|---|---|
| `mecanico1` | `taller2026` | mecánico (órdenes, clientes, vehículos) |
| `mecanico2` | `taller2026` | mecánico (para probar 2 tabletas) |
| `jefe` | `jefe2026` | admin (además: entradas de inventario) |

Se cargan datos de demostración **pequeños y sintéticos** (8 clientes, 9 vehículos, 7 repuestos) con fechas
relativas a hoy: siempre hay clientes a los que les toca hoy, mañana y pasado mañana. Antes de cada
presentación ejecute `./scripts/reiniciar_demo.sh` para regenerarlos. Guía de uso: `Guia_TallerSync.pdf`.
Las credenciales están en `.env` (copiado de `.env.example`).

Otras direcciones útiles:

- API Rust: http://localhost:3000/api/salud · telemetría: http://localhost:3000/api/metricas
- CouchDB (Fauxton): http://localhost:5984/_utils (usuario/clave de `COUCHDB_USER`/`COUCHDB_PASSWORD` en `.env`)

Detener: `./scripts/detener.sh` · Borrar también los datos: `./scripts/detener.sh --borrar`

> **Cámara para escanear:** los navegadores solo permiten la cámara en `https://` o `localhost`.
> En `http://<IP>` usa el campo de texto del escáner o un lector de códigos USB/Bluetooth (funcionan
> como teclado). Para producción se pondría HTTPS en nginx.

## 3. Cómo se usa (recorrido)

1. **Inicio:** escribir la placa del carro que llegó (Enter abre la orden) y lista de clientes a avisar
   (vencidos, hoy, mañana, pasado mañana) con botón **WhatsApp**.
2. **Vehículos:** buscar por placa, marca o cliente; registrar un carro nuevo (al guardar abre su orden).
3. **Nueva orden:** kilometraje → servicios → repuestos (lista o código de barras) → guardar. Funciona sin internet.
   El backend Rust calcula la fecha del próximo mantenimiento.
4. **Inventario:** existencias; lo que falta sale primero y en rojo. El `jefe` registra entradas.
5. **Reportes:** tasa de retorno de clientes (instrumento de la hipótesis).
6. El botón **En línea** abre la sincronización: simular corte de internet y resolver conflictos.

Las listas muestran pocos resultados (8–15) con botón “Ver más”.

## 4. Ejecutar los experimentos (fases 3–5)

```bash
./scripts/experimento_completo.sh            # versión rápida (~20 min)
COMPLETO=1 ./scripts/experimento_completo.sh  # protocolo completo (5 repeticiones, 1 000 docs; ~1 h+)
```

O por partes:

| Script | Qué hace |
|---|---|
| `./scripts/metricas_codigo.sh` | clippy, pruebas, `tsc --strict`, tamaño de binario/imagen, LOC, tiempo de compilación |
| `./scripts/experimento_carga.sh` | k6 contra Rust+CouchDB y Node+PostgreSQL con 10/50/100/200 usuarios, orden aleatorio, muestreo de RAM/CPU |
| `./scripts/experimento_red.sh` | simulador con `tc netem`: pérdida 5/15/30 %, latencia, 1 Mbps y corte total |
| `./scripts/analizar.sh` | Shapiro-Wilk, U de Mann-Whitney, ANOVA/Kruskal, Fisher, matriz SMART, gráficos y Excel |

Variables útiles: `VUS="10 50 100 200" REPS=3 DURACION=20s`, `N_DOCS=1000 REPETICIONES=5 ESCENARIOS=corte,perdida_15`.

Resultados en `experimentos/resultados/`: **`informe_resultados.md`**, `resumen_resultados.xlsx`,
`graficos/*.png`, más los datos crudos por corrida.

## 5. Documentación por fase

| Fase | Archivo |
|---|---|
| 1. Definición (entregada) | PDF del equipo |
| 2. Estado del arte | `docs/fase2_estado_del_arte.md` + `docs/matriz_antecedentes.xlsx` |
| 3. Diseño metodológico | `docs/fase3_diseno_metodologico.md` |
| 4. Desarrollo y metrología | `docs/fase4_desarrollo_metrologia.md` (+ el código) |
| 5. Análisis estadístico | `docs/fase5_analisis_metricas.md` + `experimentos/resultados/informe_resultados.md` |
| 6. Documento final | `docs/fase6_documento_final.md` (estructura de 15 apartados + referencias APA 7) |
| Exposición de 10 min | **`EXPOSICION.md`** |

## 6. Estructura del repositorio

```
backend/            Rust: domain/ application/ infrastructure/ interfaces/  (+ pruebas unitarias)
frontend/           PWA TypeScript: src/db.ts (PouchDB + replicación), src/vistas/*, public/sw.js
couchdb/            Imagen y configuración de CouchDB
baseline-monolito/  Node.js + PostgreSQL (grupo de control)
datos-semilla/      generar_semilla.py → semilla.json (datos sintéticos anonimizados)
experimentos/       k6/  sync-sim/  analisis/  resultados/
scripts/            iniciar, detener, experimentos, análisis, métricas de código
docs/               Fases 2–6 y matriz de antecedentes
```

## 7. Desarrollo (opcional)

```bash
docker compose up -d couchdb backend   # base de datos + API
cd frontend && npm install && npm run dev   # http://localhost:5173 con recarga en caliente
```

Pruebas del backend: `docker run --rm -v "$PWD/backend":/app -w /app rust:1-slim-bookworm cargo test`

## 8. Solución de problemas

| Síntoma | Solución |
|---|---|
| `permission denied` con Docker | Agregar el usuario al grupo `docker` y volver a iniciar sesión |
| Puerto 8080/3000/5984 ocupado | Cambiar el puerto izquierdo en `docker-compose.yml` |
| La tableta no ve el servidor | Misma red Wi-Fi; abrir el puerto 8080 en el firewall del servidor |
| Quiero datos limpios | `./scripts/detener.sh --borrar && ./scripts/iniciar.sh` |
| El navegador quedó con datos viejos tras borrar | Pantalla Salir → borrar datos del sitio (IndexedDB) |
| `tc` falla en el simulador | El kernel necesita el módulo `sch_netem` (`sudo modprobe sch_netem`) |
