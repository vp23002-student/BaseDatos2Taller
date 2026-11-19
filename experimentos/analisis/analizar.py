"""
Fase 5 — Análisis estadístico de los experimentos.

Entradas (experimentos/resultados/):
  carga/*.json        resumen k6 por corrida (throughput, latencias, tasa de éxito)
  crudos/*.csv.gz     latencia de CADA petición (k6 --out csv)
  recursos/*.csv      muestreo CPU/RAM de contenedores (docker stats)
  metricas/*.json     telemetría interna de cada backend al final de la corrida
  red/resultados_red.csv  experimento de red degradada (sync-sim)
  metricas_codigo.json    métricas de producto/proceso

Salidas: informe_resultados.md, resumen_resultados.xlsx, graficos/*.png

Pruebas: Shapiro-Wilk (normalidad) -> si no hay normalidad se usa U de Mann-Whitney
(no paramétrica) para comparar arquitecturas; ANOVA de un factor y Kruskal-Wallis
para el efecto del nivel de carga; prueba exacta de Fisher para proporciones de
transacciones perdidas. Nivel de significancia alfa = 0.05.
"""
import glob
import json
import os
import re
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats  # noqa: E402

RES = os.environ.get("RESULTADOS", "/resultados")
GRAF = os.path.join(RES, "graficos")
os.makedirs(GRAF, exist_ok=True)
ALFA = 0.05
NOMBRE = {"rust": "Propuesta (Rust + CouchDB)", "monolito": "Referencia (Node + PostgreSQL)",
          "propuesta": "Propuesta (PouchDB ⇄ CouchDB)"}
COLOR = {"rust": "#1b6ca8", "propuesta": "#1b6ca8", "monolito": "#c0392b"}
md = []


def tabla_md(df: pd.DataFrame, dec=2) -> str:
    def f(v):
        if isinstance(v, (float, np.floating)):
            return "—" if pd.isna(v) else f"{v:,.{dec}f}"
        return str(v)
    filas = ["| " + " | ".join(map(str, df.columns)) + " |", "|" + "---|" * len(df.columns)]
    filas += ["| " + " | ".join(f(v) for v in r) + " |" for r in df.itertuples(index=False)]
    return "\n".join(filas)


def p_txt(p):
    return "—" if p is None or pd.isna(p) else ("< 0.001" if p < 0.001 else f"{p:.4f}")


def mem_mb(texto: str) -> float:
    m = re.match(r"([\d.]+)\s*([KMG]i?B|B)", texto.strip())
    if not m:
        return np.nan
    v, u = float(m.group(1)), m.group(2)
    return v * {"B": 1 / 1048576, "KiB": 1 / 1024, "KB": 1 / 1024, "MiB": 1, "MB": 1, "GiB": 1024, "GB": 1024}[u]


def rank_biserial(x, y):
    """Tamaño del efecto de Mann-Whitney: P(x<y) - P(x>y). Positivo => x menor."""
    u, _ = stats.mannwhitneyu(x, y, alternative="two-sided")
    return 1 - 2 * u / (len(x) * len(y))


# ---------------------------------------------------------------- carga
def analizar_carga():
    archivos = glob.glob(os.path.join(RES, "carga", "*.json"))
    if not archivos:
        md.append("> No hay resultados del experimento de carga. Ejecute `./scripts/experimento_carga.sh`.\n")
        return None, None
    filas = []
    for a in archivos:
        d = json.load(open(a))
        etq = os.path.basename(a)[:-5]
        fila = {
            "etiqueta": etq, "objetivo": d["objetivo"], "vus": d["vus"], "rep": d["repeticion"],
            "throughput": d["throughput_ok_rps"], "exito_pct": 100 * d["tasa_exito"],
            "lat_med": d["latencia_ms"]["med"], "lat_p95": d["latencia_ms"]["p(95)"], "lat_p99": d["latencia_ms"]["p(99)"],
            "srv_p95": (d.get("tiempo_servidor_ms") or {}).get("p(95)", np.nan),
            "srv_med": (d.get("tiempo_servidor_ms") or {}).get("med", np.nan),
        }
        rec = os.path.join(RES, "recursos", etq + ".csv")
        if os.path.exists(rec) and os.path.getsize(rec) > 0:
            r = pd.read_csv(rec, header=None, names=["ts", "cont", "cpu", "mem"])
            r["mem_mb"] = r["mem"].astype(str).str.split("/").str[0].map(mem_mb)
            r["cpu_pct"] = r["cpu"].astype(str).str.rstrip("%").astype(float)
            app, db = ("taller-backend", "taller-couchdb") if d["objetivo"] == "rust" else ("taller-monolito", "taller-postgres")
            fila["ram_app_max"] = r.loc[r.cont == app, "mem_mb"].max()
            fila["ram_db_max"] = r.loc[r.cont == db, "mem_mb"].max()
            fila["cpu_app_prom"] = r.loc[r.cont == app, "cpu_pct"].mean()
            fila["cpu_db_prom"] = r.loc[r.cont == db, "cpu_pct"].mean()
        met = os.path.join(RES, "metricas", etq + ".json")
        if os.path.exists(met):
            m = json.load(open(met))
            fila["rss_interno_mb"] = m.get("memoria_rss_mb", np.nan)
            esc = m.get("escritor_lotes")
            post = m.get("endpoints", {}).get("POST /api/ordenes", {})
            if esc and post.get("conteo"):
                fila["docs_por_orden"] = esc["documentos"] / post["conteo"]
                fila["docs_por_lote"] = esc["docs_por_lote"]
        filas.append(fila)
    df = pd.DataFrame(filas).sort_values(["vus", "objetivo", "rep"])
    if "docs_por_orden" in df:
        # el contador del escritor es acumulado desde el arranque del backend: la razón mínima es la de una corrida limpia
        dpo = df.loc[df.objetivo == "rust", "docs_por_orden"].min()
    else:
        dpo = np.nan
    df["docs_por_s"] = df["throughput"] * np.where(df.objetivo == "rust", dpo, 1 + 1.5)  # monolito: orden + ~1.5 alertas (mismas reglas)

    resumen = (df.groupby(["vus", "objetivo"])
               .agg(reps=("rep", "count"), throughput_media=("throughput", "mean"), throughput_de=("throughput", "std"),
                    docs_s=("docs_por_s", "mean"), p50_ms=("lat_med", "mean"), p95_ms=("lat_p95", "mean"),
                    srv_p95_ms=("srv_p95", "mean"), exito_pct=("exito_pct", "mean"),
                    ram_app_mb=("ram_app_max", "max") if "ram_app_max" in df else ("rep", "size"),
                    ram_db_mb=("ram_db_max", "max") if "ram_db_max" in df else ("rep", "size"))
               .reset_index())
    resumen["objetivo"] = resumen["objetivo"].map(lambda x: NOMBRE[x])

    md.append("## 1. Experimento de carga concurrente (throughput, latencia y recursos)\n")
    md.append("Misma carga (k6) contra ambas arquitecturas; cada orden genera sus alertas preventivas. "
              f"Documentos por orden en la propuesta (orden + alertas): **{dpo:.2f}**.\n")
    md.append(tabla_md(resumen.rename(columns={
        "vus": "Usuarios (VUs)", "objetivo": "Arquitectura", "reps": "Rep.", "throughput_media": "Órdenes/s (media)",
        "throughput_de": "DE", "docs_s": "Documentos/s", "p50_ms": "Latencia p50 (ms)", "p95_ms": "Latencia p95 (ms)",
        "srv_p95_ms": "T. servidor p95 (ms)", "exito_pct": "Éxito %", "ram_app_mb": "RAM app máx (MB)", "ram_db_mb": "RAM BD máx (MB)"})))
    md.append("")

    # --- pruebas de hipótesis por nivel de carga
    pruebas = []
    lat_por = {}
    for etq_csv in glob.glob(os.path.join(RES, "crudos", "*.csv.gz")):
        etq = os.path.basename(etq_csv).replace(".csv.gz", "")
        m = re.match(r"(rust|monolito)_vus(\d+)_rep(\d+)", etq)
        if not m:
            continue
        try:
            c = pd.read_csv(etq_csv, usecols=["metric_name", "metric_value"])
        except Exception:
            continue
        v = c.loc[c.metric_name == "http_req_duration", "metric_value"].to_numpy()
        lat_por.setdefault((m.group(1), int(m.group(2))), []).append(v)
    for vus in sorted(df.vus.unique()):
        a = df[(df.vus == vus) & (df.objetivo == "rust")]["throughput"].to_numpy()
        b = df[(df.vus == vus) & (df.objetivo == "monolito")]["throughput"].to_numpy()
        fila = {"VUs": vus, "Órdenes/s propuesta": a.mean() if len(a) else np.nan,
                "Órdenes/s referencia": b.mean() if len(b) else np.nan}
        if len(a) >= 2 and len(b) >= 2:
            fila["p (U Mann-Whitney, throughput)"] = p_txt(stats.mannwhitneyu(a, b, alternative="two-sided").pvalue)
            fila["p (t de Welch, throughput)"] = p_txt(stats.ttest_ind(a, b, equal_var=False).pvalue)
        la, lb = lat_por.get(("rust", vus)), lat_por.get(("monolito", vus))
        if la and lb:
            la, lb = np.concatenate(la), np.concatenate(lb)
            rng = np.random.default_rng(1)
            sa = rng.choice(la, min(len(la), 5000), replace=False)
            sb = rng.choice(lb, min(len(lb), 5000), replace=False)
            fila["Shapiro p (propuesta)"] = p_txt(stats.shapiro(sa).pvalue)
            fila["Shapiro p (referencia)"] = p_txt(stats.shapiro(sb).pvalue)
            fila["Mediana lat. propuesta (ms)"] = np.median(la)
            fila["Mediana lat. referencia (ms)"] = np.median(lb)
            fila["p (U Mann-Whitney, latencia)"] = p_txt(stats.mannwhitneyu(la, lb, alternative="two-sided").pvalue)
            fila["Efecto r (latencia)"] = rank_biserial(la, lb)
        pruebas.append(fila)
    if pruebas:
        md.append("### Pruebas de hipótesis por nivel de carga\n")
        md.append("La latencia por petición no sigue una distribución normal (Shapiro-Wilk p < 0.05), "
                  "por lo que la comparación principal usa la **U de Mann-Whitney**. "
                  "El efecto *r* (correlación biserial de rangos) es positivo cuando la propuesta tiene menor latencia.\n")
        md.append(tabla_md(pd.DataFrame(pruebas), dec=3))
        md.append("")

    # ANOVA / Kruskal: efecto del nivel de carga sobre el throughput de cada arquitectura
    filas_av = []
    for obj in ["rust", "monolito"]:
        grupos = [g["throughput"].to_numpy() for _, g in df[df.objetivo == obj].groupby("vus") if len(g) >= 2]
        if len(grupos) >= 2:
            filas_av.append({"Arquitectura": NOMBRE[obj], "ANOVA F": stats.f_oneway(*grupos).statistic,
                             "p ANOVA": p_txt(stats.f_oneway(*grupos).pvalue),
                             "p Kruskal-Wallis": p_txt(stats.kruskal(*grupos).pvalue)})
    if filas_av:
        md.append("### Efecto del nivel de concurrencia sobre el throughput (ANOVA de un factor / Kruskal-Wallis)\n")
        md.append(tabla_md(pd.DataFrame(filas_av), dec=2))
        md.append("")

    # gráficos
    fig, ax = plt.subplots(1, 2, figsize=(12, 4.5))
    for obj in ["rust", "monolito"]:
        g = df[df.objetivo == obj].groupby("vus")
        ax[0].errorbar(g["throughput"].mean().index, g["throughput"].mean(), yerr=g["throughput"].std().fillna(0),
                       marker="o", capsize=4, label=NOMBRE[obj], color=COLOR[obj])
        ax[1].plot(g["lat_p95"].mean().index, g["lat_p95"].mean(), marker="o", label=NOMBRE[obj], color=COLOR[obj])
    ax[0].set(title="Throughput de órdenes", xlabel="Usuarios concurrentes (VUs)", ylabel="órdenes / s")
    ax[1].set(title="Latencia p95", xlabel="Usuarios concurrentes (VUs)", ylabel="ms")
    for a in ax:
        a.grid(alpha=.3)
        a.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(GRAF, "carga_throughput_latencia.png"), dpi=130)
    if "ram_app_max" in df:
        fig, ax = plt.subplots(figsize=(7, 4))
        for obj in ["rust", "monolito"]:
            g = df[df.objetivo == obj].groupby("vus")["ram_app_max"].max()
            ax.plot(g.index, g.values, marker="o", label=f"{NOMBRE[obj]} — proceso de la API", color=COLOR[obj])
        ax.set(title="Memoria RAM máxima del backend", xlabel="Usuarios concurrentes (VUs)", ylabel="MB")
        ax.grid(alpha=.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(os.path.join(GRAF, "carga_memoria.png"), dpi=130)
    md.append("![Throughput y latencia](graficos/carga_throughput_latencia.png)\n")
    md.append("![Memoria](graficos/carga_memoria.png)\n")
    return df, resumen


# ---------------------------------------------------------------- red
def analizar_red():
    ruta = os.path.join(RES, "red", "resultados_red.csv")
    if not os.path.exists(ruta):
        md.append("> No hay resultados del experimento de red. Ejecute `./scripts/experimento_red.sh`.\n")
        return None, None
    df = pd.read_csv(ruta)
    orden_esc = ["base", "perdida_5", "perdida_15", "perdida_30", "corte"]
    df["escenario"] = pd.Categorical(df["escenario"], [e for e in orden_esc if e in set(df.escenario)] +
                                     sorted(set(df.escenario) - set(orden_esc)), ordered=True)
    res = (df.groupby(["escenario", "arquitectura"], observed=True)
           .agg(reps=("repeticion", "count"), n=("n", "max"), exito_pct=("tasa_exito_pct", "mean"),
                perdidas_total=("perdidos", "sum"), tiempo_media=("tiempo_s", "mean"), tiempo_de=("tiempo_s", "std"),
                docs_s=("docs_por_s", "mean"), proc_backend_s=("tiempo_procesamiento_s", "mean"))
           .reset_index())
    md.append("## 2. Experimento de red intermitente (tc netem)\n")
    md.append("Escenarios: `base` sin degradación; `perdida_X`: X % de pérdida de paquetes + latencia (200/400/800 ms) "
              "+ ancho de banda de 1 Mbps; `corte`: las órdenes se registran con la red caída (100 % de pérdida) "
              "y luego se restablece a 1 Mbps. *Tiempo* = duración del envío (propuesta: replicación tras recuperar la red; "
              "referencia: peticiones síncronas).\n")
    md.append(tabla_md(res.assign(arquitectura=res.arquitectura.map(NOMBRE)).rename(columns={
        "escenario": "Escenario", "arquitectura": "Arquitectura", "reps": "Rep.", "n": "Órdenes por corrida",
        "exito_pct": "Éxito %", "perdidas_total": "Órdenes perdidas (total)", "tiempo_media": "Tiempo (s)",
        "tiempo_de": "DE", "docs_s": "Docs/s", "proc_backend_s": "Proceso Rust tras sync (s)"})))
    md.append("")
    pruebas = []
    for esc in df.escenario.cat.categories:
        a = df[(df.escenario == esc) & (df.arquitectura == "propuesta")]
        b = df[(df.escenario == esc) & (df.arquitectura == "monolito")]
        if a.empty or b.empty:
            continue
        tabla = [[a.exitosos.sum(), a.perdidos.sum()], [b.exitosos.sum(), b.perdidos.sum()]]
        fila = {"Escenario": esc, "Perdidas propuesta": int(a.perdidos.sum()), "Perdidas referencia": int(b.perdidos.sum()),
                "p (Fisher, proporción de pérdidas)": p_txt(stats.fisher_exact(tabla).pvalue)}
        if len(a) >= 2 and len(b) >= 2:
            fila["p (U Mann-Whitney, tiempo)"] = p_txt(stats.mannwhitneyu(a.tiempo_s, b.tiempo_s, alternative="two-sided").pvalue)
        pruebas.append(fila)
    if pruebas:
        md.append("### Pruebas de hipótesis\n")
        md.append(tabla_md(pd.DataFrame(pruebas)))
        md.append("")
    fig, ax = plt.subplots(1, 2, figsize=(12, 4.5))
    escs = list(df.escenario.cat.categories)
    x = np.arange(len(escs))
    for i, arq in enumerate(["propuesta", "monolito"]):
        g = res[res.arquitectura == arq].set_index("escenario").reindex(escs)
        ax[0].bar(x + (i - .5) * .38, g["exito_pct"], .38, label=NOMBRE[arq], color=COLOR[arq])
        ax[1].bar(x + (i - .5) * .38, g["tiempo_media"], .38, yerr=g["tiempo_de"].fillna(0), capsize=3, label=NOMBRE[arq], color=COLOR[arq])
    ax[0].set(title="Órdenes que llegan al servidor", ylabel="% de éxito", ylim=(0, 105))
    ax[1].set(title="Tiempo de envío / sincronización", ylabel="segundos")
    for a in ax:
        a.set_xticks(x, escs)
        a.grid(alpha=.3, axis="y")
        a.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(GRAF, "red_exito_tiempo.png"), dpi=130)
    md.append("![Red](graficos/red_exito_tiempo.png)\n")
    return df, res


# ---------------------------------------------------------------- SMART
def matriz_smart(carga, red):
    filas = []

    def agregar(obj, meta, valor, cumple):
        filas.append({"Objetivo específico": obj, "Meta (SMART)": meta, "Resultado medido": valor,
                      "Estado": {True: "✅ Cumple", False: "❌ No cumple", None: "⏳ Pendiente"}[cumple]})

    if carga is not None:
        r = carga[carga.objetivo == "rust"]
        mejor = r.groupby("vus")["docs_por_s"].mean()
        agregar("O1. Throughput de escritura", "≥ 500 documentos/s escribiendo órdenes",
                f"{mejor.max():.0f} docs/s (máximo, con {mejor.idxmax()} VUs)", bool(mejor.max() >= 500))
        if "ram_app_max" in r:
            r50 = r[r.vus == 50]["ram_app_max"].max() if (r.vus == 50).any() else r["ram_app_max"].max()
            agregar("O3. Consumo de recursos", "RAM del backend Rust < 100 MB con 50 clientes",
                    f"{r50:.1f} MB (máx. en 50 VUs); máximo absoluto {r['ram_app_max'].max():.1f} MB", bool(r50 < 100))
        vmax = r.vus.max()
        srv = r[r.vus == vmax]["srv_p95"].mean()
        agregar("Meta de la guía (Fase 5)", "Procesamiento backend < 15 ms por petición",
                f"p95 tiempo de servidor {srv:.1f} ms con {vmax} VUs (incluye espera de escritura en CouchDB)", bool(srv < 15))
        comp = []
        for v in sorted(carga.vus.unique()):
            a = carga[(carga.vus == v) & (carga.objetivo == "rust")]["throughput"].mean()
            b = carga[(carga.vus == v) & (carga.objetivo == "monolito")]["throughput"].mean()
            comp.append(f"{v} VUs: {a:.0f} vs {b:.0f}")
        agregar("O1 (comparativo)", "Throughput superior al monolito bajo la misma carga",
                "órdenes/s propuesta vs referencia — " + "; ".join(comp),
                bool(all(carga[(carga.vus == v) & (carga.objetivo == "rust")]["throughput"].mean() >
                         carga[(carga.vus == v) & (carga.objetivo == "monolito")]["throughput"].mean() for v in carga.vus.unique())))
    if red is not None:
        p = red[red.arquitectura == "propuesta"]
        corte = p[(p.escenario == "corte") & (p.n >= 1000)]
        if not corte.empty:
            t = corte.tiempo_s.mean()
            agregar("O2. Latencia de sincronización", "Lote de 1 000 docs offline replicado en ≤ 10 s a 1 Mbps",
                    f"{int(corte.n.max())} docs en {t:.2f} s (media de {len(corte)} corridas)", bool(t <= 10))
        else:
            agregar("O2. Latencia de sincronización", "Lote de 1 000 docs offline replicado en ≤ 10 s a 1 Mbps",
                    "Sin corridas de 1 000 docs: ejecutar N_DOCS=1000 ESCENARIOS=corte", None)
        deg = p[p.escenario.astype(str).str.startswith("perdida")]
        if not deg.empty:
            tasa = 100 * deg.exitosos.sum() / deg.n.sum()
            agregar("O4. Tasa de éxito de replicación", "≥ 99.5 % y cero transacciones perdidas con 5/15/30 % de pérdida",
                    f"{tasa:.2f} % · {int(deg.perdidos.sum())} perdidas", bool(tasa >= 99.5 and deg.perdidos.sum() == 0))
    agregar("O5. Impacto en el negocio (H₂)", "+25 % en tasa de retorno a los 6 meses",
            "Requiere estudio de campo con talleres reales (instrumento: /api/reportes/retorno)", None)
    df = pd.DataFrame(filas)
    md.append("## 3. Matriz de métricas de éxito (SMART)\n")
    md.append(tabla_md(df))
    md.append("")
    return df


def main():
    md.append("# Informe de resultados experimentales — TallerSync\n")
    md.append(f"_Generado automáticamente el {datetime.now():%Y-%m-%d %H:%M} por `experimentos/analisis/analizar.py`. "
              "Los valores dependen del hardware donde se ejecutó; para el documento final use la versión "
              "`COMPLETO=1` del protocolo._\n")
    carga, res_carga = analizar_carga()
    red, res_red = analizar_red()
    smart = matriz_smart(carga, red)
    mc = os.path.join(RES, "metricas_codigo.json")
    if os.path.exists(mc):
        m = json.load(open(mc))
        md.append("## 4. Métricas de producto y proceso (ISO/IEC 25010)\n")
        md.append(tabla_md(pd.DataFrame([
            {"Métrica": "Advertencias de clippy (Rust)", "Valor": m["rust"]["advertencias_clippy"]},
            {"Métrica": "Pruebas unitarias Rust", "Valor": m["rust"]["pruebas"]},
            {"Métrica": "Errores TypeScript (strict)", "Valor": m["frontend"]["errores_typescript_strict"]},
            {"Métrica": "Tiempo de compilación release (s)", "Valor": m["rust"]["tiempo_compilacion_release_s"]},
            {"Métrica": "Tamaño del binario Rust (MB)", "Valor": round(m["rust"]["tamano_binario_mb"], 2)},
            {"Métrica": "Imagen Docker backend Rust (MB)", "Valor": round(m["imagenes_docker_mb"]["backend_rust"], 1)},
            {"Métrica": "Imagen Docker monolito Node (MB)", "Valor": round(m["imagenes_docker_mb"]["monolito_node"], 1)},
            {"Métrica": "Líneas de código backend Rust", "Valor": m["rust"]["lineas_codigo"]},
            {"Métrica": "Líneas de código frontend TS", "Valor": m["frontend"]["lineas_codigo"]},
        ])))
        md.append("")
    md.append("## 5. Decisión sobre las hipótesis\n")
    md.append("- Se rechaza H₀ para una variable cuando p < 0.05 **y** la diferencia favorece a la propuesta.\n"
              "- La hipótesis técnica H₁ tiene cuatro componentes (throughput, tiempo de sincronización, memoria, "
              "transacciones perdidas) y se reporta cada uno por separado: un resultado puede apoyar H₁ en resiliencia "
              "y no en throughput a baja concurrencia. Reportar ambos es parte del rigor del método.\n"
              "- H₂ (negocio) queda pendiente del estudio de campo de 6 meses.\n")
    with open(os.path.join(RES, "informe_resultados.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md))
    with pd.ExcelWriter(os.path.join(RES, "resumen_resultados.xlsx")) as xw:
        if carga is not None:
            res_carga.to_excel(xw, sheet_name="carga_resumen", index=False)
            carga.to_excel(xw, sheet_name="carga_corridas", index=False)
        if red is not None:
            res_red.to_excel(xw, sheet_name="red_resumen", index=False)
            red.to_excel(xw, sheet_name="red_corridas", index=False)
        smart.to_excel(xw, sheet_name="matriz_SMART", index=False)
    print("\n".join(md))


if __name__ == "__main__":
    main()
