"""Le pone a los barrios del mapa sus nombres en castellano, y los deja pegados.

POR QUE EXISTE
--------------
graphify agrupa el proyecto en "barrios" (comunidades) y les pone de nombre el
archivo que mas pesa en cada uno: "ConciliacionTab.tsx". Eso no le dice nada a
nadie. Nosotros los queremos en castellano: "Conciliacion bancaria".

Pero el nombre puesto a mano se perdia en cada commit. La causa exacta:
graphify guarda los nombres en `graphify-out/.graphify_labels.json` y los valida
contra un archivo hermano `.graphify_labels.json.sig`, que es la FIRMA de quien
vivia en cada barrio. Si la firma no esta, y la cantidad de barrios cambio
aunque sea en uno, tira TODOS los nombres y los reemplaza por el archivo
dominante. Sin la firma, los nombres duran hasta el proximo commit.

Este script escribe las dos cosas: los nombres Y la firma. A partir de ahi cada
barrio conserva su nombre mientras su contenido no cambie. El que si cambio
pierde el nombre a proposito: ya no es el mismo barrio, y un nombre viejo sobre
contenido nuevo miente.

COMO SE USA
-----------
    "$(cat graphify-out/.graphify_python)" scripts/graphify/nombrar.py

Los nombres viven en `scripts/graphify/barrios.json`, versionado, para que
viajen entre las dos maquinas y se vayan mejorando. Agregar un barrio nuevo es
agregar un renglon ahi y volver a correr esto.

OJO: regenera graph.json y graph.html, pero NO GRAPH_REPORT.md — ese se rehace
solo en el proximo commit, y ahi ya sale con los nombres puestos.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / 'graphify-out'
GRAFO = SALIDA / 'graph.json'
NOMBRES = Path(__file__).resolve().parent / 'barrios.json'


def main() -> int:
    if not GRAFO.exists():
        print(f'No esta {GRAFO}. Corre primero /graphify . para armar el mapa.')
        return 1

    curados = {k: v for k, v in json.loads(NOMBRES.read_text(encoding='utf-8')).items()
               if not k.startswith('_')}
    grafo = json.loads(GRAFO.read_text(encoding='utf-8'))

    por_barrio: dict[int, list[dict]] = defaultdict(list)
    for nodo in grafo['nodes']:
        por_barrio[nodo.get('community')].append(nodo)

    # El archivo que mas pesa en cada barrio es su ancla: sobrevive a los
    # renumerados de comunidades, que es lo que rompia el enfoque por id.
    ancla_de: dict[int, str] = {}
    for cid, nodos in por_barrio.items():
        archivos = Counter((n.get('source_file') or '').replace('\\', '/')
                           for n in nodos if n.get('source_file'))
        if archivos:
            ancla_de[cid] = archivos.most_common(1)[0][0]

    # Dos barrios pueden compartir ancla. El mas grande se queda con el nombre
    # limpio; los otros llevan un sufijo, para que nunca haya dos iguales.
    orden = sorted(por_barrio, key=lambda c: -len(por_barrio[c]))
    usados: Counter[str] = Counter()
    etiquetas: dict[int, str] = {}
    for cid in orden:
        nombre = curados.get(ancla_de.get(cid, ''))
        if not nombre:
            continue
        usados[nombre] += 1
        etiquetas[cid] = nombre if usados[nombre] == 1 else f'{nombre} ({usados[nombre]})'

    # Los barrios sin nombre curado conservan el que ya tenian (el del archivo
    # dominante). No se pisan con un placeholder.
    for cid, nodos in por_barrio.items():
        if cid not in etiquetas:
            actual = nodos[0].get('community_name')
            if actual:
                etiquetas[cid] = actual

    # 1) Los nombres.
    (SALIDA / '.graphify_labels.json').write_text(
        json.dumps({str(k): v for k, v in sorted(etiquetas.items())},
                   ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    # 2) La firma. Sin esto los nombres duran hasta el proximo commit.
    from graphify.cluster import community_member_sigs
    comunidades = {cid: [n['id'] for n in nodos] for cid, nodos in por_barrio.items()}
    firmas = community_member_sigs(comunidades)
    (SALIDA / '.graphify_labels.json.sig').write_text(
        json.dumps({str(k): v for k, v in sorted(firmas.items())}, ensure_ascii=False),
        encoding='utf-8')

    # 3) El mapa en si, para que el grafico ya salga con los nombres.
    for nodo in grafo['nodes']:
        nuevo = etiquetas.get(nodo.get('community'))
        if nuevo:
            nodo['community_name'] = nuevo
    GRAFO.write_text(json.dumps(grafo, ensure_ascii=False), encoding='utf-8')

    en_castellano = sum(1 for cid in etiquetas if curados.get(ancla_de.get(cid, '')))
    print(f'Barrios: {len(por_barrio)} | en castellano: {en_castellano} | '
          f'con nombre de archivo: {len(por_barrio) - en_castellano}')
    print(f'Firma escrita: {(SALIDA / ".graphify_labels.json.sig").name} '
          f'({len(firmas)} barrios) -> los nombres ya no se pierden en el commit.')
    sin_usar = sorted(set(curados) - {ancla_de.get(c, "") for c in etiquetas})
    if sin_usar:
        print(f'\nOJO: {len(sin_usar)} nombre(s) de barrios.json no engancharon con '
              f'ningun barrio (se movio o se borro el archivo):')
        for a in sin_usar:
            print(f'  - {a}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
