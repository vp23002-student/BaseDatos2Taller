#!/usr/bin/env bash
# Análisis estadístico (Fase 5): normalidad, U de Mann-Whitney, ANOVA/Kruskal, Fisher,
# matriz SMART, gráficos y Excel. Lee experimentos/resultados y escribe ahí mismo.
source "$(dirname "$0")/comun.sh"
docker compose --profile herramientas build analisis >/dev/null
docker compose --profile herramientas run --rm analisis python analizar.py
echo "Informe: experimentos/resultados/informe_resultados.md"
