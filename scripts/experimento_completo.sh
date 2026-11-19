#!/usr/bin/env bash
# Ejecuta TODO el protocolo experimental y el análisis.
#   ./scripts/experimento_completo.sh          -> versión rápida (~15 min)
#   COMPLETO=1 ./scripts/experimento_completo.sh -> versión del protocolo (~1 h+)
source "$(dirname "$0")/comun.sh"
if [ "${COMPLETO:-0}" = 1 ]; then
  export VUS="10 50 100 200" REPS=5 DURACION=30s N_DOCS=1000 REPETICIONES=5
else
  export VUS="10 50 100 200" REPS=3 DURACION=15s N_DOCS=200 REPETICIONES=3
fi
"$RAIZ/scripts/metricas_codigo.sh"
"$RAIZ/scripts/experimento_carga.sh"
"$RAIZ/scripts/experimento_red.sh"
"$RAIZ/scripts/analizar.sh"
