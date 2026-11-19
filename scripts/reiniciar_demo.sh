#!/usr/bin/env bash
# Deja la demo como nueva: borra la base y la vuelve a llenar con datos de HOY
# (clientes que tocan hoy, mañana y pasado mañana). Úselo antes de cada clase.
DIR="$(dirname "$0")"
"$DIR/detener.sh" --borrar
"$DIR/iniciar.sh"
echo
echo "Listo. Abra http://localhost:8080 (si la tableta ya tenía datos viejos, se limpian solos al entrar)."
