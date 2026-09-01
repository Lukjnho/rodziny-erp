# Instala el agente de impresión de Rodziny en esta PC.
#
# Hace tres cosas y nada más:
#   1. Deja el agente arrancando solo cada vez que se prende la máquina.
#   2. Lo arranca ahora, para no tener que reiniciar.
#   3. Dice qué impresora encontró.
#
# NO necesita permisos de administrador y no instala ningún programa: usa el
# PowerShell que ya viene con Windows.
#
# La impresora NO se configura acá: el agente busca sola una térmica al
# arrancar, y desde el ERP (Caja → Impresora) se puede elegir otra y probarla.

$ErrorActionPreference = 'Stop'

$aca = Split-Path -Parent $MyInvocation.MyCommand.Path
$agente = Join-Path $aca 'agente-impresion.ps1'

if (-not (Test-Path $agente)) {
  Write-Host "No encuentro 'agente-impresion.ps1' al lado de este instalador." -ForegroundColor Red
  Write-Host "Copia la carpeta entera y volve a intentar."
  Read-Host "Enter para cerrar"
  exit 1
}

Write-Host ''
Write-Host '  Agente de impresion de Rodziny' -ForegroundColor Cyan
Write-Host '  ------------------------------'
Write-Host ''

# ── 1. Dejarlo en el arranque ────────────────────────────────────────────────
# Va un .vbs y no un acceso directo para que NO parpadee una ventana negra cada
# vez que se prende la PC.
$inicio = [Environment]::GetFolderPath('Startup')
$lanzador = Join-Path $inicio 'Rodziny - agente de impresion.vbs'

$vbs = @"
' Arranca el agente de impresion de Rodziny sin mostrar ventana.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$agente""", 0, False
"@
Set-Content -Path $lanzador -Value $vbs -Encoding ASCII
Write-Host '  [OK] Va a arrancar solo con Windows' -ForegroundColor Green

# ── 2. Arrancarlo ────────────────────────────────────────────────────────────
$estado = $null
try { $estado = Invoke-RestMethod -Uri 'http://localhost:9110/estado' -TimeoutSec 2 } catch { }

if ($estado -and $estado.ok) {
  Write-Host '  [OK] Ya estaba corriendo' -ForegroundColor Green
} else {
  Start-Process wscript.exe -ArgumentList "`"$lanzador`""
  Start-Sleep -Seconds 3
  try { $estado = Invoke-RestMethod -Uri 'http://localhost:9110/estado' -TimeoutSec 3 } catch { }
  if ($estado -and $estado.ok) {
    Write-Host '  [OK] Arrancado' -ForegroundColor Green
  } else {
    Write-Host '  [!] Arranco pero no contesta todavia. Proba de nuevo en unos segundos.' -ForegroundColor Yellow
  }
}

# ── 3. Qué impresora encontró ────────────────────────────────────────────────
Write-Host ''
if ($estado -and $estado.impresora) {
  if ($estado.instalada) {
    Write-Host "  [OK] Impresora elegida: $($estado.impresora)" -ForegroundColor Green
  } else {
    Write-Host "  [!] Tiene configurada '$($estado.impresora)' pero ya no esta en esta PC." -ForegroundColor Yellow
    Write-Host '      Elegi otra desde el ERP, en Caja -> Impresora.'
  }
} else {
  Write-Host '  [!] No encontre ninguna impresora termica en esta PC.' -ForegroundColor Yellow
  Write-Host '      Las que hay son:'
  Get-Printer -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "        - $($_.Name)" }
  Write-Host ''
  Write-Host '      Si la termica no aparece en la lista, lo que falta es la COLA'
  Write-Host '      de impresion (no el driver). Para crearla, con la impresora'
  Write-Host '      enchufada y en una consola como administrador:'
  Write-Host ''
  Write-Host '        Add-PrinterDriver -Name "Generic / Text Only"' -ForegroundColor Gray
  Write-Host '        Add-Printer -Name "POS-80" -DriverName "Generic / Text Only" -PortName "USB001"' -ForegroundColor Gray
  Write-Host ''
  Write-Host '      (fijate el puerto real con: Get-PrinterPort | Where-Object Name -like "USB*")'
}

Write-Host ''
Write-Host '  Listo. Abri la caja en el ERP y toca "Impresora" para elegirla,'
Write-Host '  ajustarla y hacer una prueba en papel.'
Write-Host ''
Write-Host '  Si algo no anda, el detalle queda en:'
Write-Host "    $env:LOCALAPPDATA\RodzinyImpresion\agente.log"
Write-Host ''
Write-Host '  Para sacarlo del arranque, borra este archivo:'
Write-Host "    $lanzador"
Write-Host ''
Read-Host '  Enter para cerrar'
