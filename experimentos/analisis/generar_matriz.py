"""
Fase 2 — Genera la Matriz de Antecedentes en Excel (docs/matriz_antecedentes.xlsx).

IMPORTANTE: son obras reales y conocidas del área, pero ANTES de entregar el
documento verifiquen cada referencia (DOI, páginas, acceso) en la biblioteca
institucional (IEEE Xplore, ACM DL, ScienceDirect, Scopus) y complétenla con los
artículos que encuentren con las cadenas booleanas de la Fase 2.

Uso: docker compose --profile herramientas run --rm analisis python generar_matriz.py
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

COLUMNAS = ["N°", "Autor(es)", "Año", "Título", "Fuente", "DOI / ISBN", "Base de datos sugerida", "Tipo",
            "Eje temático", "Aporte principal", "Método", "Relación con el proyecto", "Limitación / brecha"]

FILAS = [
    ["Kleppmann, M., Wiggins, A., van Hardenberg, P., & McGranaghan, M.", 2019,
     "Local-first software: You own your data, in spite of the cloud",
     "Onward! 2019 (ACM SIGPLAN)", "10.1145/3359591.3359737", "ACM Digital Library", "Artículo de conferencia",
     "Offline-first / local-first", "Propone siete ideales del software local-first: datos primero en el dispositivo y sincronización posterior.",
     "Análisis conceptual + prototipos con CRDT", "Fundamenta que la tableta guarde la réplica completa y opere sin red.",
     "No evalúa backends compilados ni CouchDB en microempresas."],
    ["Anderson, J. C., Lehnardt, J., & Slater, N.", 2010, "CouchDB: The Definitive Guide",
     "O'Reilly Media", "ISBN 978-0-596-15589-6", "Catálogo de biblioteca", "Libro",
     "NoSQL documental / replicación", "Describe el modelo documental JSON, MVCC, vistas map/reduce y la replicación de CouchDB.",
     "Descriptivo técnico", "Base del modelo de datos, vistas de inventario y manejo de conflictos.",
     "Versión 1.x; no incluye Mango ni clúster de CouchDB 3."],
    ["Brewer, E.", 2012, "CAP twelve years later: How the \"rules\" have changed",
     "Computer, 45(2), 23–29", "10.1109/MC.2012.37", "IEEE Xplore", "Artículo de revista",
     "Sistemas distribuidos", "Reinterpreta el teorema CAP: durante una partición se elige disponibilidad o consistencia y luego se reconcilia.",
     "Ensayo analítico", "Justifica priorizar disponibilidad (seguir trabajando sin red) y consistencia eventual.",
     "Marco teórico, sin mediciones."],
    ["Vogels, W.", 2009, "Eventually consistent", "Communications of the ACM, 52(1), 40–44",
     "10.1145/1435417.1435432", "ACM Digital Library", "Artículo de revista", "Consistencia eventual",
     "Define modelos de consistencia eventual usados en sistemas a gran escala.", "Ensayo técnico",
     "Sustenta el modelo de consistencia entre tabletas y servidor.", "Contexto de centros de datos, no de redes intermitentes de borde."],
    ["Bailis, P., & Ghodsi, A.", 2013, "Eventual consistency today: Limitations, extensions, and beyond",
     "Communications of the ACM, 56(5), 55–63", "10.1145/2447976.2447992", "ACM Digital Library", "Artículo de revista",
     "Consistencia eventual", "Revisa garantías y límites de la consistencia eventual y cómo medirla.", "Revisión",
     "Guía para definir la métrica de tasa de éxito de replicación.", "No aborda aplicaciones de negocio pequeñas."],
    ["Shapiro, M., Preguiça, N., Baquero, C., & Zawirski, M.", 2011, "Conflict-free replicated data types",
     "SSS 2011, LNCS 6976, 386–400 (Springer)", "10.1007/978-3-642-24550-3_29", "SpringerLink / Scopus", "Artículo de conferencia",
     "Resolución de conflictos", "Formaliza estructuras de datos replicadas que convergen sin coordinación.",
     "Formal / demostraciones", "Inspira el diseño append-only (alertas y movimientos de inventario sin sobrescribir).",
     "CouchDB no usa CRDT nativos; requiere estrategia propia."],
    ["Terry, D. B., Theimer, M. M., Petersen, K., Demers, A. J., Spreitzer, M. J., & Hauser, C. H.", 1995,
     "Managing update conflicts in Bayou, a weakly connected replicated storage system",
     "SOSP '95 (ACM)", "10.1145/224056.224070", "ACM Digital Library", "Artículo de conferencia",
     "Conectividad débil", "Sistema replicado para clientes con conexión intermitente y resolución de conflictos por aplicación.",
     "Diseño e implementación de sistema", "Antecedente clásico de trabajo desconectado y fusión posterior.",
     "Tecnología de los 90; sin métricas con hardware moderno."],
    ["Kistler, J. J., & Satyanarayanan, M.", 1992, "Disconnected operation in the Coda file system",
     "ACM Transactions on Computer Systems, 10(1), 3–25", "10.1145/146941.146942", "ACM Digital Library", "Artículo de revista",
     "Operación desconectada", "Demuestra que los clientes pueden seguir operando desconectados y reintegrar cambios.",
     "Implementación + evaluación empírica", "Respaldo histórico del enfoque offline-first.", "Sistema de archivos, no base documental."],
    ["Satyanarayanan, M.", 2017, "The emergence of edge computing", "Computer, 50(1), 30–39",
     "10.1109/MC.2017.9", "IEEE Xplore", "Artículo de revista", "Edge computing",
     "Explica por qué procesar cerca del usuario reduce latencia y dependencia de la nube.", "Ensayo / visión",
     "Encaja la tableta del taller como nodo de borde.", "No cuantifica escenarios de PYMEs."],
    ["Cattell, R.", 2011, "Scalable SQL and NoSQL data stores", "ACM SIGMOD Record, 39(4), 12–27",
     "10.1145/1978915.1978919", "ACM Digital Library", "Artículo de revista", "NoSQL vs. relacional",
     "Compara almacenes SQL y NoSQL (incluido CouchDB) por modelo de datos, escalabilidad y consistencia.", "Revisión comparativa",
     "Marco para comparar la propuesta con el monolito relacional.", "Comparación cualitativa, sin pruebas bajo red degradada."],
    ["Jung, R., Jourdan, J.-H., Krebbers, R., & Dreyer, D.", 2018,
     "RustBelt: Securing the foundations of the Rust programming language",
     "Proceedings of the ACM on Programming Languages, 2(POPL), 66", "10.1145/3158154", "ACM Digital Library",
     "Artículo de revista", "Rust / seguridad de memoria", "Prueba formal de la seguridad de memoria y concurrencia del sistema de tipos de Rust.",
     "Verificación formal", "Sustenta la elección de Rust por seguridad en concurrencia.", "No mide rendimiento de servicios web."],
    ["Pereira, R., Couto, M., Ribeiro, F., Rua, R., Cunha, J., Fernandes, J. P., & Saraiva, J.", 2017,
     "Energy efficiency across programming languages", "SLE 2017 (ACM)", "10.1145/3136014.3136031", "ACM Digital Library",
     "Artículo de conferencia", "Rendimiento de lenguajes compilados", "Mide tiempo, memoria y energía de 27 lenguajes; Rust entre los más eficientes.",
     "Experimental (benchmarks)", "Apoya usar Rust en servidores de bajo costo.", "Benchmarks de algoritmos, no APIs con base de datos."],
    ["Klabnik, S., & Nichols, C.", 2023, "The Rust programming language (2nd ed.)", "No Starch Press",
     "ISBN 978-1-7185-0310-6", "Catálogo de biblioteca", "Libro", "Rust",
     "Referencia del lenguaje: ownership, borrowing, async/await.", "Descriptivo", "Base técnica del backend.", "—"],
    ["Hemminger, S.", 2005, "Network emulation with NetEm", "Linux Conference Australia (linux.conf.au)",
     "—", "Web del evento / Google Scholar", "Artículo de conferencia", "Simulación de red",
     "Presenta netem para emular retardo, pérdida y reordenamiento de paquetes en Linux.", "Descriptivo técnico",
     "Herramienta del entorno controlado (tc netem).", "No define escenarios para PYMEs."],
    ["ISO/IEC", 2011, "ISO/IEC 25010: Systems and software Quality Requirements and Evaluation (SQuaRE) — Quality models",
     "International Organization for Standardization", "ISO/IEC 25010:2011", "ISO", "Estándar",
     "Calidad de software", "Define características de calidad (eficiencia de desempeño, fiabilidad, mantenibilidad...).",
     "Normativo", "Marco de las métricas de producto (CPU, RAM, mantenibilidad).", "Existe revisión 2023: verificar cuál exige la cátedra."],
    ["Hernández-Sampieri, R., & Mendoza, C.", 2018,
     "Metodología de la investigación: Las rutas cuantitativa, cualitativa y mixta", "McGraw-Hill",
     "ISBN 978-1-4562-6096-5", "Catálogo de biblioteca", "Libro", "Metodología",
     "Diseños cuasiexperimentales y pruebas de hipótesis.", "Metodológico", "Diseño cuasiexperimental del estudio de campo.", "—"],
    ["Mann, H. B., & Whitney, D. R.", 1947,
     "On a test of whether one of two random variables is stochastically larger than the other",
     "The Annals of Mathematical Statistics, 18(1), 50–60", "10.1214/aoms/1177730491", "JSTOR / Project Euclid",
     "Artículo de revista", "Estadística", "Prueba no paramétrica para comparar dos grupos independientes.", "Estadístico",
     "Prueba usada para comparar latencias entre arquitecturas.", "—"],
    ["Shapiro, S. S., & Wilk, M. B.", 1965, "An analysis of variance test for normality (complete samples)",
     "Biometrika, 52(3–4), 591–611", "10.1093/biomet/52.3-4.591", "JSTOR / Oxford Academic", "Artículo de revista",
     "Estadística", "Prueba de normalidad.", "Estadístico", "Decide entre pruebas paramétricas y no paramétricas.", "—"],
]

wb = Workbook()
ws = wb.active
ws.title = "Matriz de antecedentes"
ws.append(COLUMNAS)
for i, f in enumerate(FILAS, 1):
    ws.append([i] + f)
encabezado = PatternFill("solid", fgColor="0F3D5E")
for c in ws[1]:
    c.font = Font(bold=True, color="FFFFFF")
    c.fill = encabezado
    c.alignment = Alignment(wrap_text=True, vertical="center")
anchos = [5, 34, 7, 42, 30, 26, 20, 16, 22, 48, 22, 44, 40]
for i, w in enumerate(anchos, 1):
    ws.column_dimensions[get_column_letter(i)].width = w
for fila in ws.iter_rows(min_row=2):
    for c in fila:
        c.alignment = Alignment(wrap_text=True, vertical="top")
ws.freeze_panes = "B2"

b = wb.create_sheet("Estrategia de búsqueda")
for fila in [
    ["Cadena booleana principal", '("Apache CouchDB" OR "offline-first databases") AND ("Rust backend" OR "high performance backend") AND ("Flutter" OR "TypeScript")'],
    ["Cadena ampliada 1", '("offline-first" OR "local-first") AND ("replication" OR "synchronization") AND ("intermittent connectivity" OR "unreliable network")'],
    ["Cadena ampliada 2", '("Rust" AND ("web server" OR "backend") AND ("performance" OR "latency" OR "memory"))'],
    ["Cadena ampliada 3", '("NoSQL" OR "document database") AND ("small business" OR "SME" OR "microenterprise")'],
    ["Cadena ampliada 4", '("preventive maintenance" OR "vehicle maintenance") AND ("information system" OR "reminder")'],
    ["Repositorios", "IEEE Xplore, ACM Digital Library, ScienceDirect, Scopus (acceso institucional UES)"],
    ["Criterios de inclusión", "2010–2026 (más clásicos fundacionales), inglés/español, revisados por pares, con evaluación técnica o fundamento teórico directo"],
    ["Criterios de exclusión", "Sin acceso a texto completo, duplicados, literatura gris sin datos verificables"],
    ["Registro", "Anotar por cadena: fecha de búsqueda, base, resultados totales, tamizados por título/resumen, incluidos"],
]:
    b.append(fila)
b.column_dimensions["A"].width = 26
b.column_dimensions["B"].width = 120
for c in b["A"]:
    c.font = Font(bold=True)

wb.save("/docs/matriz_antecedentes.xlsx")
print(f"OK /docs/matriz_antecedentes.xlsx ({len(FILAS)} antecedentes)")
