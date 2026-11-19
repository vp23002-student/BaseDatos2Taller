#!/usr/bin/env bash
# Levanta la aplicación: CouchDB + backend Rust + PWA (nginx)
source "$(dirname "$0")/comun.sh"
titulo "Construyendo y levantando TallerSync (la primera vez tarda unos minutos: compila Rust)"
docker compose up -d --build
esperar_salud http://localhost:8080/api/salud
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
cat <<MSG

  TallerSync listo
  • Aplicación (tableta):  http://localhost:8080      (en la red local: http://${IP:-<ip>}:8080)
  • API Rust:              http://localhost:3000/api/salud   ·  métricas: /api/metricas
  • CouchDB (Fauxton):     http://localhost:5984/_utils      (usuario ${COUCHDB_USER})

  Usuarios de demo:  ${MECANICO1_USER} / ${MECANICO1_PASS}   (mecánico)
                     ${TALLER_ADMIN_USER} / ${TALLER_ADMIN_PASS}       (admin: inventario)
MSG
