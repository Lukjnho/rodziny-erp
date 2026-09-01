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
3. Listo. Queda arrancando solo con Windows.

No hace falta ser administrador y no se instala ningún programa: usa el
PowerShell que ya trae Windows.

## Configurar la impresora

**No se toca ningún archivo.** Al arrancar por primera vez, el agente busca sola
una impresora con pinta de térmica y la deja elegida. Para cambiarla o
calibrarla: en el ERP, abrir la caja y tocar **🖨 Impresora**.

Ahí se puede:

- **Elegir la impresora** entre las de esa PC (marca cuál parece térmica).
- **Ajustar el ancho**: 48 caracteres en rollo de 80 mm, 32 en 58 mm.
- **Ajustar los acentos**: si en vez de "Ñoquis" salen símbolos raros, se cambia
  la tabla de caracteres.
- **Guardar y probar**: imprime un ticket de prueba en papel.

⚠️ La configuración es **de esa computadora**, no del ERP: cada caja tiene su
impresora. Si mañana se cobra desde otra PC, se instala el agente ahí y se
configura ahí.

### Cómo leer el ticket de prueba

Trae una fila de números (`123456789012…`). **Si entra justa en un renglón, el
ancho está bien.** Si se corta y sigue abajo, hay que bajarlo; si sobra mucho
espacio, subirlo. También trae "Ñoquis · Jamón · Menú del día" para ver los
acentos, y una línea en letra doble para confirmar el tamaño.

## Si algo no sale

**Sigue apareciendo el cartel de imprimir.** El ERP no encontró el agente y usó
el camino viejo. La caja **igual imprime**, así que no es urgente. Abrir
`http://localhost:9110/estado` en el navegador de esa PC: tiene que contestar
algo como `{"ok":true,...}`. Si no contesta, ejecutar `instalar.ps1` de nuevo.

**La impresora no aparece en la lista.** Casi nunca es el driver: lo que falta es
la **cola de impresión**. Con la impresora enchufada, en una consola como
administrador:

```powershell
Get-PrinterPort | Where-Object Name -like "USB*"     # ver el puerto real
Add-PrinterDriver -Name "Generic / Text Only"
Add-Printer -Name "POS-80" -DriverName "Generic / Text Only" -PortName "USB001"
```

**Imprime muy lento (un ticket por minuto).** Es el spooler trabado, no el
driver: `Restart-Service Spooler` (como administrador) y dejar la cola en modo
spool, no en impresión directa.

**El detalle de cada impresión** queda anotado en:
`%LOCALAPPDATA%\RodzinyImpresion\agente.log`

**La configuración** vive en:
`%LOCALAPPDATA%\RodzinyImpresion\config.json`

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
- ⚠️ Los `.ps1` de esta carpeta están guardados **con marca de UTF-8 (BOM)**.
  Sin eso, PowerShell 5.1 los lee como ANSI y cualquier "ñ" adentro de un texto
  rompe el archivo entero.
