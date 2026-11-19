#!/usr/bin/env bash
# Métricas de PRODUCTO y PROCESO (Fase 4, ISO/IEC 25010): análisis estático con clippy,
# pruebas unitarias, chequeo de tipos del frontend, tamaño de binario/imagen, líneas de código
# y tiempo de compilación.
source "$(dirname "$0")/comun.sh"
SAL="$RES/metricas_codigo.json"
titulo "Rust: clippy + tests + compilación release"
T0=$(date +%s)
SALIDA_RUST=$(docker run --rm -v "$RAIZ/backend":/app -v cargo-cache:/usr/local/cargo/registry -v taller-target:/app/target -w /app rust:1-slim-bookworm sh -c '
  rustup component add clippy >/dev/null 2>&1
  echo "CLIPPY_WARN=$(cargo clippy --message-format short 2>&1 | grep -c "^src/.*warning" || true)"
  echo "TESTS=$(cargo test 2>&1 | grep "test result" | head -1)"
  S=$(date +%s); cargo build --release -q 2>/dev/null; E=$(date +%s)
  echo "BUILD_S=$((E-S))"
  echo "BIN_BYTES=$(stat -c %s target/release/taller-backend)"
  rustc --version | sed "s/^/RUSTC=/"')
docker run --rm -v "$RAIZ/backend":/b alpine rm -rf /b/target
echo "$SALIDA_RUST"
titulo "Frontend: tsc --strict"
TSC_ERR=$(cd frontend && (npx --yes tsc --noEmit 2>&1 || true) | grep -c "error TS" || true)
echo "TSC_ERRORES=$TSC_ERR"
loc() { find "$@" -type f \( -name '*.rs' -o -name '*.ts' -o -name '*.js' \) -not -path '*/node_modules/*' -not -path '*/dist/*' | xargs cat | grep -cv '^\s*$'; }
IMG_BACK=$(docker image inspect tallersync-backend --format '{{.Size}}' 2>/dev/null || echo 0)
IMG_MONO=$(docker image inspect tallersync-monolito --format '{{.Size}}' 2>/dev/null || echo 0)
v() { echo "$SALIDA_RUST" | grep "^$1=" | cut -d= -f2-; }
cat > "$SAL" <<JSON
{
  "fecha": "$(date -Iseconds)",
  "rust": { "version": "$(v RUSTC)", "advertencias_clippy": $(v CLIPPY_WARN), "pruebas": "$(v TESTS)",
            "tiempo_compilacion_release_s": $(v BUILD_S), "tamano_binario_mb": $(awk "BEGIN{print $(v BIN_BYTES)/1048576}"),
            "lineas_codigo": $(loc backend/src) },
  "frontend": { "errores_typescript_strict": $TSC_ERR, "lineas_codigo": $(loc frontend/src) },
  "monolito": { "lineas_codigo": $(loc baseline-monolito/server.js) },
  "imagenes_docker_mb": { "backend_rust": $(awk "BEGIN{print $IMG_BACK/1048576}"), "monolito_node": $(awk "BEGIN{print $IMG_MONO/1048576}") },
  "tiempo_total_script_s": $(( $(date +%s) - T0 ))
}
JSON
cat "$SAL"
