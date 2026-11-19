#!/usr/bin/env bash
# Funciones compartidas por los scripts.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
[ -f .env ] || cp .env.example .env
export HOST_UID="$(id -u)" HOST_GID="$(id -g)"
RES="$RAIZ/experimentos/resultados"
mkdir -p "$RES"/{carga,crudos,recursos,red,metricas,graficos}
set -a; source .env; set +a
titulo() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
esperar_salud() {
  for _ in $(seq 1 90); do
    curl -fs "$1" >/dev/null 2>&1 && return 0; sleep 2
  done
  echo "No respondió $1" >&2; return 1
}
