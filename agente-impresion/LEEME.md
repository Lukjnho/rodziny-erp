# Agente de impresión de Rodziny

Para que la comanda **salga sola** en la impresora térmica, sin el cartel de
imprimir del navegador.

## El problema que resuelve

El navegador no sabe hablarle a una impresora térmica. Solo sabe "imprimir una
página", que abre el diálogo y hay que confirmar. En el mostrador de Vedia, con
unos 65 tickets por turno, eso es un clic de más 65 veces por turno.

Este agente corre en la PC de la caja y hace de puente: recibe el ticket del ERP
y se lo manda a la impresora en su propio idioma (ESC/POS). Sale solo, corta el
papel y —si está conectada— abre la gaveta.

## Instalar

1. Copiar **toda esta carpeta** a la PC de la caja (por ejemplo a
   `C:\Rodziny\agente-impresion`).
2. Click derecho en `instalar.ps1` → **Ejecutar con PowerShell**.
3. Listo. Cobrar una venta de prueba: la comanda tiene que salir sin que
   aparezca ningún cartel.

No hace falta ser administrador y no se instala ningún programa: usa el
PowerShell que ya trae Windows.

## Si algo no sale

**Sigue apareciendo el cartel de imprimir.** El ERP no encontró el agente y usó
el camino viejo. La caja **igual imprime**, así que no es urgente. Revisar:

- ¿Está corriendo? Abrir `http://localhost:9110/estado` en el navegador de esa
  PC. Tiene que contestar algo como `{"ok":true,...}`.
- Si no contesta, ejecutar `instalar.ps1` de nuevo.

**Sale con símbolos raros en lugar de las eñes y los acentos.** Abrir
`agente-impresion.ps1` y cambiar `$TABLA_IMPRESORA`: probar `16`, y si no `0`.
Cada modelo de térmica trae una tabla distinta.

**El ticket sale cortado a lo ancho, o con mucho aire.** En el mismo archivo,
cambiar `$ANCHO`. 48 es lo normal en 80 mm; algunas usan 42.

**Dice que no encuentra la impresora.** El nombre tiene que ser igual al que
muestra Windows. Para ver los nombres: abrir PowerShell y escribir `Get-Printer`.
Después cambiar `$IMPRESORA_POR_DEFECTO` en `agente-impresion.ps1`.

**El detalle de cada impresión** queda anotado en:
`%LOCALAPPDATA%\RodzinyImpresion\agente.log`

## Probar sin gastar papel

El agente tiene una vista previa que muestra cómo quedaría el ticket sin
imprimirlo. Desde PowerShell, en esa PC:

```powershell
$cuerpo = '{"lineas":[{"x":"RODZINY","c":true,"b":true,"s":2},{"k":"sep"},{"k":"lr","x":"TOTAL","y":"$27.000","b":true}]}'
$r = Invoke-RestMethod -Uri http://localhost:9110/vista-previa -Method Post -Body $cuerpo -ContentType 'application/json'
$r.papel
```

## Para sacarlo

Borrar el archivo `Rodziny - agente de impresion.vbs` de la carpeta de Inicio
(el instalador dice la ruta exacta al terminar) y reiniciar. El ERP vuelve solo
al diálogo del navegador: **no se queda sin imprimir**.

## Cómo está armado

- El **diseño del ticket vive en el ERP**, no acá. El agente solo traduce
  renglones a ESC/POS. Así se puede cambiar el ticket con un deploy, sin volver
  a instalar nada en las PCs de los locales.
- El ERP prueba el agente y, si no contesta en 2,5 segundos, usa el diálogo.
  Cuando el agente no está instalado ni siquiera se espera: el navegador rechaza
  la conexión al instante.
- Escucha solo en `localhost`: no se puede llegar desde otra PC de la red.
