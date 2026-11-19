#!/usr/bin/env bash
# Detiene todo. Con --borrar elimina también los datos (volúmenes).
source "$(dirname "$0")/comun.sh"
if [ "${1:-}" = "--borrar" ]; then
  docker compose --profile experimento --profile herramientas down -v
else
  docker compose --profile experimento --profile herramientas down
fi
