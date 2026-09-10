"""Baja de Supabase el esquema REALMENTE APLICADO y lo deja como .sql para el mapa.

POR QUE EXISTE
--------------
El mapa lee los 207 archivos de `supabase/migrations/`, o sea que conoce la base
**tal como fue escrita**. Lo escrito y lo aplicado no son lo mismo: la migracion
072 esta escrita y nunca se aplico. Esa diferencia ya mordio y es la Regla 2 del
CLAUDE.md.

Este script pregunta a la base de verdad y escribe una FOTO del esquema real:
tablas con sus columnas, vistas, funciones y claves foraneas. Graphify lo lee
como un archivo mas del proyecto, asi que el mapa pasa a conocer las dos cosas:
lo escrito y lo aplicado.

⚠️ NO REEMPLAZA a `scripts/mapa-erp/`. Esto NO trae las policies de RLS, que es
lo que aquel mide (cuantas tablas guardan el `local` y la regla no lo mira).
Son dos cosas distintas y las dos hacen falta.

POR QUE NO USA UNA CONTRASEÑA
-----------------------------
graphify trae un lector propio (`--postgres DSN`) que hace justo esto, pero pide
la cadena de conexion de Postgres, o sea una contraseña de la base guardada en
algun lado. No hace falta: el token de la Management API que ya esta en la
maquina alcanza, y aca solo se hacen SELECT. Una llave que no existe no se
filtra.

CUANDO CORRERLO
---------------
Despues de aplicar una migracion. El esquema no cambia solo: cambia cuando
alguien aplica algo, y eso siempre pasa dentro de una sesion.

    "C:/Users/Usuario/AppData/Local/Programs/Python/Python313/python.exe" scripts/graphify/esquema_aplicado.py
    /graphify . --update      # para que el mapa lo tome
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
DESTINO = RAIZ / 'supabase' / 'esquema-aplicado.sql'
REF = 'hiolgfvtcilblmqyxuxm'
CLAUDE_JSON = Path.home() / '.claude.json'

CONSULTAS: dict[str, str] = {
    'TABLAS': """
        with cols as (
          select c.table_name,
                 string_agg('  ' || quote_ident(c.column_name) || ' ' ||
                   case when c.data_type = 'USER-DEFINED' then c.udt_name else c.data_type end ||
                   case when c.is_nullable = 'NO' then ' not null' else '' end,
                   E',\\n' order by c.ordinal_position) as cuerpo
            from information_schema.columns c
            join information_schema.tables t
              on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
           group by c.table_name)
        select string_agg('create table public.' || quote_ident(table_name) ||
                          E' (\\n' || cuerpo || E'\\n);', E'\\n\\n' order by table_name) as ddl
          from cols
    """,
    'VISTAS': """
        select string_agg('create view public.' || quote_ident(table_name) ||
                          ' as ' || rtrim(btrim(view_definition), ';') || ';',
                          E'\\n\\n' order by table_name) as ddl
          from information_schema.views
         where table_schema = 'public'
    """,
    'FUNCIONES': """
        select string_agg('-- ' || coalesce(l.lanname, '?') ||
                 case when p.prosecdef then ' · SECURITY DEFINER' else '' end || E'\\n' ||
                 'create function public.' || quote_ident(p.proname) ||
                 '(' || pg_get_function_arguments(p.oid) || ') returns ' ||
                 pg_get_function_result(p.oid) || ';', E'\\n\\n'
                 order by p.proname, p.oid) as ddl
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          left join pg_language l on l.oid = p.prolang
         where n.nspname = 'public' and p.prokind = 'f'
    """,
    'CLAVES FORANEAS': """
        select string_agg('alter table public.' || quote_ident(t.relname) ||
                 ' add constraint ' || quote_ident(c.conname) || ' ' ||
                 pg_get_constraintdef(c.oid) || ';', E'\\n' order by t.relname, c.conname) as ddl
          from pg_constraint c
          join pg_class t on t.oid = c.conrelid
          join pg_namespace n on n.oid = t.relnamespace
         where n.nspname = 'public' and c.contype = 'f'
    """,
    'INDICES': """
        select string_agg(indexdef || ';', E'\\n' order by tablename, indexname) as ddl
          from pg_indexes
         where schemaname = 'public'
    """,
    # La migracion 072 —el ejemplo que nombra la Regla 2 del CLAUDE.md— no crea
    # ninguna tabla: prende Realtime. Sin esta consulta la foto no servia para
    # el caso que dice servir.
    'REALTIME (publicaciones)': """
        select string_agg('alter publication ' || quote_ident(pubname) ||
                 ' add table public.' || quote_ident(tablename) || ';',
                 E'\\n' order by pubname, tablename) as ddl
          from pg_publication_tables
         where schemaname = 'public'
    """,
}

# Estas pueden venir vacias con toda razon: si Realtime esta apagado del todo,
# vacio ES la respuesta correcta y no un error. Para las demas, vacio significa
# que algo se rompio y hay que plantarse.
PUEDEN_VENIR_VACIAS = {'REALTIME (publicaciones)'}

CABECERA = """-- ============================================================================
--  ⛔ NO EJECUTAR ESTE ARCHIVO. NO ES UNA MIGRACION.
-- ============================================================================
--
--  Es una FOTO del esquema que esta REALMENTE APLICADO en Supabase, generada
--  automaticamente por scripts/graphify/esquema_aplicado.py.
--
--  Para que sirve: el mapa lee los archivos de supabase/migrations/, o sea la
--  base "tal como fue escrita". Esto le da la otra mitad: la base tal como
--  esta. Lo escrito y lo aplicado no son lo mismo (la migracion 072 esta
--  escrita y nunca se aplico).
--
--  Lo que NO trae: las policies de RLS. Eso lo mide scripts/mapa-erp/.
--
--  Generado: {fecha}
--  {resumen}
-- ============================================================================
"""


def token() -> str:
    m = re.search(r'sbp_[a-zA-Z0-9]+', CLAUDE_JSON.read_text(encoding='utf-8', errors='ignore'))
    if not m:
        print('No encontre el token sbp_ en ~/.claude.json')
        sys.exit(1)
    return m.group(0)


def consultar(tok: str, sql: str) -> str:
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode('utf-8'),
        headers={'Authorization': f'Bearer {tok}',
                 'Content-Type': 'application/json',
                 # Sin User-Agent, Cloudflare corta con 403 / error 1010: el que
                 # manda urllib por defecto esta en su lista negra.
                 'User-Agent': 'rodziny-erp/esquema-aplicado'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            filas = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f'HTTP {e.code}: {e.read().decode("utf-8", "replace")[:400]}')
        sys.exit(1)
    return (filas[0].get('ddl') or '') if filas else ''


def main() -> int:
    tok = token()
    partes, resumen = [], []
    for titulo, sql in CONSULTAS.items():
        ddl = consultar(tok, sql)
        # Cada consulta devuelve UNA celda. Si vuelve vacia es que algo cambio
        # en el catalogo: mejor plantarse que escribir una foto incompleta que
        # despues se lee como si fuera la verdad.
        if not ddl.strip():
            if titulo not in PUEDEN_VENIR_VACIAS:
                print(f'{titulo}: vino vacio. No escribo el archivo.')
                return 1
            resumen.append(f'0 {titulo.lower()}')
            partes.append(f'-- ── {titulo} ' + '─' * max(0, 60 - len(titulo)) +
                          '\n\n-- (ninguna: no hay ninguna tabla publicada)\n')
            print(f'  {titulo}: 0  <-- OJO, esto puede ser un hallazgo')
            continue
        # Una sentencia por punto y coma. Sirve parejo para las seis consultas;
        # contar por 'create'/'alter' fallaba con los indices, que vienen en
        # mayusculas desde pg_indexes.
        n = ddl.count(';')
        resumen.append(f'{n} {titulo.lower()}')
        partes.append(f'-- ── {titulo} ' + '─' * max(0, 60 - len(titulo)) + f'\n\n{ddl}\n')
        print(f'  {titulo}: {n}')

    fecha = datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M %z')
    texto = CABECERA.format(fecha=fecha, resumen=' · '.join(resumen)) + '\n' + '\n'.join(partes)
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(texto, encoding='utf-8')
    print(f'\n{DESTINO.relative_to(RAIZ)}  ({len(texto):,} caracteres)')
    print('Ahora: /graphify . --update  para que el mapa lo tome.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
