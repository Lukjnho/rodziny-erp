"""Genera los iconos de la app con la marca Rodziny.

POR QUE EXISTE
--------------
Hasta el 10-sep-2026 los iconos eran los de la plantilla Vite: un cuadrado
violeta liso (#8B3DFF) para instalar en el celular y un rayo violeta/celeste de
favicon. Nada de eso es Rodziny.

QUE DIBUJA, Y POR QUE ESO
-------------------------
La **R** del wordmark, recortada del logo original — la capitular con serifas de
cuña, flanqueada en el logo por los dos rombos.

Se probo primero sintetizar una MEZZALUNA (la cuchilla curva sobre la que esta
parado el paisano del logo). Quedo pareciendo un ANCLA: la media luna con un
mango en T es exactamente la silueta de un ancla, y un ancla en una fabrica de
pastas esta mal. Descartado.

El logo entero no sirve de icono: es un grabado con sombrero, remo y bajada.
A 32 pixeles no se lee nada. La letra si.

Los rombos (◆ R ◆) quedaron afuera a proposito: a 32 pixeles son dos motas de
3 pixeles, ruido.

Paleta del manual: Harina sobre Salsa.
  Salsa  #BD3220   Madera #412C1B   Harina #E8DDC7

TODO A SANGRE, SIN ESQUINAS REDONDEADAS
---------------------------------------
Los PNG salen a sangre (cuadrado lleno) a proposito:
  · iOS le pone SU propia mascara redondeada al apple-touch-icon. Si el PNG ya
    viene redondeado quedan las dos curvas encimadas y se ve sucio.
  · El `purpose: maskable` del manifest exige fondo hasta el borde, porque el
    sistema recorta a gusto (circulo, cuadrado, gota).
La letra queda dentro de la ZONA SEGURA (circulo del 80% centrado), asi que
ningun recorte se la come. El favicon SVG si lleva esquinas redondeadas: ese se
muestra tal cual, nadie lo enmascara.

COMO SE CORRE
-------------
    "C:/Users/Usuario/AppData/Local/Programs/Python/Python313/python.exe" scripts/marca/iconos.py

Necesita Pillow y el logo en G:. Escribe public/icon-192.png, public/icon-512.png
y public/favicon.svg.
"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ModuleNotFoundError:
    print('Falta Pillow. Instalar con: python -m pip install Pillow')
    sys.exit(1)

RAIZ = Path(__file__).resolve().parents[2]
PUBLIC = RAIZ / 'public'
LOGO = Path(r'G:\Mi unidad\claude-memoria-rodziny\assets\logo-rodziny-negro.png')

SALSA = (0xBD, 0x32, 0x20, 255)
HARINA = (0xE8, 0xDD, 0xC7, 255)
SALSA_HEX = '#BD3220'

# La R dentro del logo original (712x830). Medido: el wordmark vive en
# y 633-743, y la R es el grupo de columnas 42-127, con columnas vacias a los
# dos lados, asi que el recorte no se lleva nada de las letras vecinas.
CAJA_R = (42, 634, 128, 743)

LADO = 512
ALTO_LETRA = 270      # sobre el lienzo de 512
RADIO_SEGURO = LADO * 0.8 / 2


def mascara_de_la_letra() -> Image.Image:
    """Devuelve la R como mascara en escala de grises (255 = tinta)."""
    logo = Image.open(LOGO).convert('RGBA')
    r = logo.crop(CAJA_R)
    ancho, alto = r.size

    tinta = Image.new('L', (ancho, alto), 0)
    src = r.load()
    dst = tinta.load()
    for y in range(alto):
        for x in range(ancho):
            cr, cg, cb, ca = src[x, y]
            # Se usa el GRIS REAL del borde, no un corte duro en blanco/negro.
            # El logo trae los bordes suavizados; tirarlos y volver a inventarlos
            # despues de agrandar 2,5 veces fue lo que dejo la letra escalonada.
            gris = 255 - round((cr + cg + cb) / 3)
            dst[x, y] = round(gris * ca / 255)
    return tinta


def escalar_nitido(mascara: Image.Image, alto_destino: int) -> Image.Image:
    """Agranda la mascara y le devuelve el filo.

    El origen es chico (86x109): agrandar 2,5 veces deja los bordes lavados.
    LANCZOS suaviza bien, y despues una curva de contraste empuja los grises
    del medio hacia los extremos, asi la letra recupera el canto sin quedar
    dentada.
    """
    ancho, alto = mascara.size
    SOBRE = 4  # se trabaja 4 veces mas grande y recien al final se achica

    # 1) Agrandar de mas. Aca la escalera del origen queda bien visible.
    enorme = mascara.resize(
        (round(ancho * alto_destino * SOBRE / alto), alto_destino * SOBRE), Image.LANCZOS)

    # 2) Desenfocar. Es el paso que promedia los escalones y los vuelve curva.
    #    Ninguna curva de contraste arregla una escalera; hay que difuminarla
    #    primero. El radio va atado a cuanto se agrando el origen.
    radio = 1.6 * alto_destino * SOBRE / alto
    enorme = enorme.filter(ImageFilter.GaussianBlur(radius=radio))

    # 3) Devolverle el filo con una curva en S sobre el 50%.
    tabla = []
    for v in range(256):
        t = (v - 96) / 64  # franja de transicion 96..160
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
        tabla.append(round(255 * t * t * (3 - 2 * t)))  # smoothstep
    enorme = enorme.point(tabla)

    # 4) Achicar al tamano final: aca nace el antialias bueno.
    return enorme.resize((round(enorme.width / SOBRE), alto_destino), Image.LANCZOS)


def componer(lado: int, letra: Image.Image) -> Image.Image:
    img = Image.new('RGBA', (LADO, LADO), SALSA)
    x = (LADO - letra.width) // 2
    y = (LADO - letra.height) // 2
    img.paste(HARINA, (x, y), letra)
    return img if lado == LADO else img.resize((lado, lado), Image.LANCZOS)


def zona_segura_ok(letra: Image.Image) -> bool:
    """Las cuatro esquinas de la letra tienen que caer dentro del circulo del 80%."""
    medio_ancho = letra.width / 2
    medio_alto = letra.height / 2
    dist = (medio_ancho ** 2 + medio_alto ** 2) ** 0.5
    if dist > RADIO_SEGURO:
        print(f'  La letra se sale: media diagonal {dist:.0f} > radio seguro {RADIO_SEGURO:.0f}')
        return False
    print(f'  Zona segura OK: media diagonal {dist:.0f} / {RADIO_SEGURO:.0f}')
    return True


def escribir_favicon(letra: Image.Image) -> None:
    """SVG con la R embebida en PNG.

    La letra es un mapa de bits (sale del logo), asi que no hay trazo que
    vectorizar. Un SVG con un PNG adentro es SVG valido, y a 16-32 pixeles
    que es donde se ve un favicon, 256 pixeles de origen sobran.
    """
    chico = letra.resize((round(letra.width * 256 / letra.height), 256), Image.LANCZOS)
    tinta = Image.new('RGBA', chico.size, HARINA)
    tinta.putalpha(chico)
    buf = io.BytesIO()
    tinta.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')

    ancho = chico.width
    x = (LADO - round(ancho * ALTO_LETRA / 256)) / 2
    w = round(ancho * ALTO_LETRA / 256)
    y = (LADO - ALTO_LETRA) / 2
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LADO} {LADO}">\n'
        f'  <!-- Rodziny. La R del wordmark en Harina sobre Salsa.\n'
        f'       Generado por scripts/marca/iconos.py - no editar a mano. -->\n'
        f'  <rect width="{LADO}" height="{LADO}" rx="96" fill="{SALSA_HEX}"/>\n'
        f'  <image x="{x:.0f}" y="{y:.0f}" width="{w}" height="{ALTO_LETRA}"\n'
        f'         href="data:image/png;base64,{b64}"/>\n'
        f'</svg>\n'
    )
    destino = PUBLIC / 'favicon.svg'
    destino.write_text(svg, encoding='utf-8')
    print(f'  {destino.relative_to(RAIZ)}  ({destino.stat().st_size:,} bytes)')


def main() -> int:
    if not LOGO.exists():
        print(f'No esta el logo en {LOGO}')
        return 1
    letra = escalar_nitido(mascara_de_la_letra(), ALTO_LETRA)
    if not zona_segura_ok(letra):
        return 1
    for lado in (192, 512):
        destino = PUBLIC / f'icon-{lado}.png'
        componer(lado, letra).save(destino, 'PNG', optimize=True)
        print(f'  {destino.relative_to(RAIZ)}  ({destino.stat().st_size:,} bytes)')
    escribir_favicon(letra)
    return 0


if __name__ == '__main__':
    sys.exit(main())
