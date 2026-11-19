#!/usr/bin/env bash
# EXPERIMENTO 2 — Resiliencia ante red intermitente (tc netem dentro del contenedor cliente).
#   N_DOCS=1000 REPETICIONES=5 ESCENARIOS=base,perdida_5,perdida_15,perdida_30,corte ./scripts/experimento_red.sh
source "$(dirname "$0")/comun.sh"
titulo "Levantando ambas arquitecturas"
docker compose --profile experimento up -d --build
esperar_salud http://localhost:3000/api/salud
esperar_salud http://localhost:4000/api/salud
docker compose --profile herramientas build sync-sim >/dev/null
titulo "Simulación de red degradada (N_DOCS=${N_DOCS:-200}, REPETICIONES=${REPETICIONES:-3})"
docker compose --profile herramientas run --rm \
  -e N_DOCS="${N_DOCS:-200}" -e REPETICIONES="${REPETICIONES:-3}" \
  -e ESCENARIOS="${ESCENARIOS:-base,perdida_5,perdida_15,perdida_30,corte}" \
  sync-sim
