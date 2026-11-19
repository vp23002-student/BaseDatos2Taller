#!/usr/bin/env bash
# EXPERIMENTO 1 — Throughput, latencia y recursos bajo carga concurrente.
# Misma carga (k6) contra: backend Rust + CouchDB  vs.  monolito Node + PostgreSQL.
#   VUS="10 50 100 200" REPS=3 DURACION=20s ./scripts/experimento_carga.sh
source "$(dirname "$0")/comun.sh"
VUS="${VUS:-10 50 100 200}"; REPS="${REPS:-3}"; DURACION="${DURACION:-20s}"
titulo "Levantando ambas arquitecturas"
docker compose --profile experimento up -d --build
esperar_salud http://localhost:3000/api/salud
esperar_salud http://localhost:4000/api/salud

# Corridas en orden ALEATORIO (aleatorización de lotes de prueba)
CORRIDAS=$(for r in $(seq 1 "$REPS"); do for v in $VUS; do for t in rust monolito; do echo "$t $v $r"; done; done; done | shuf)
TOTAL=$(echo "$CORRIDAS" | wc -l); i=0
while read -r OBJ V R; do
  i=$((i+1)); ETQ="${OBJ}_vus${V}_rep${R}"
  titulo "[$i/$TOTAL] $ETQ"
  curl -s -X POST localhost:3000/api/metricas/reiniciar >/dev/null
  curl -s -X POST localhost:4000/api/metricas/reiniciar >/dev/null
  # Muestreo de CPU/RAM de los contenedores cada segundo durante la prueba
  ( while true; do
      docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' \
        | grep -E 'taller-(backend|couchdb|monolito|postgres)' | sed "s/^/$(date +%s),/"
    done ) > "$RES/recursos/$ETQ.csv" &
  MUESTREO=$!
  # -T y </dev/null: sin esto `docker compose run` consume la lista de corridas por stdin
  docker compose --profile herramientas run --rm -T -e OBJETIVO="$OBJ" -e VUS="$V" -e REPETICION="$R" -e DURACION="$DURACION" \
    k6 run --quiet --out csv="/resultados/crudos/$ETQ.csv.gz" /scripts/carga_ordenes.js </dev/null | grep '\[' || true
  kill $MUESTREO 2>/dev/null; wait $MUESTREO 2>/dev/null || true
  PUERTO=$([ "$OBJ" = rust ] && echo 3000 || echo 4000)
  curl -s "localhost:$PUERTO/api/metricas" > "$RES/metricas/$ETQ.json"
  sleep 3
done <<< "$CORRIDAS"
titulo "Listo. Resultados en experimentos/resultados/{carga,crudos,recursos,metricas}"
