# Instala el agente de impresión de Rodziny en esta PC.
#
# Hace dos cosas y nada más:
#   1. Deja el agente arrancando solo cada vez que se prende la máquina.
#   2. Lo arranca ahora, para no tener que reiniciar.
#
# NO necesita permisos de administrador y no instala ningún programa: usa el
# PowerShell que ya viene con Windows.
#
# Para desinstalarlo: borrar el archivo que queda en la carpeta de Inicio
# (se muestra al final) y cerrar el proceso, o simplemente reiniciar.

$ErrorActionPreference = 'Stop'

$aca = Split-Path -Parent $MyInvocation.MyCommand.Path
$agente = Join-Path $aca 'agente-impresion.ps1'

if (-not (Test-Path $agente)) {
  Write-Host "No encuentro 'agente-impresion.ps1' al lado de este instalador." -ForegroundColor Red
  Write-Host "Copiá la carpeta entera y volvé a intentar."
  Read-Host "Enter para cerrar"
  exit 1
}

Write-Host ""
Write-Host "  Agente de impresion de Rodziny" -ForegroundColor Cyan
Write-Host "  ------------------------------"
Write-Host ""

# ── 1. Chequear que la impresora exista ──────────────────────────────────────
$configurada = (Select-String -Path $agente -Pattern "^\`$IMPRESORA_POR_DEFECTO\s*=\s*'([^']+)'" |
  Select-Object -First 1).Matches.Groups[1].Value

$impresora = Get-Printer -Name $configurada -ErrorAction SilentlyContinue
if ($impresora) {
  Write-Host "  [OK] Impresora '$configurada' encontrada ($($impresora.DriverName), $($impresora.PortName))" -ForegroundColor Green
} else {
  Write-Host "  [!] No encuentro una impresora llamada '$configurada'." -ForegroundColor Yellow
  Write-Host "      Las que hay en esta PC son:"
  Get-Printer | ForEach-Object { Write-Host "        - $($_.Name)" }
  Write-Host ""
  Write-Host "      Si la termica tiene otro nombre, abri agente-impresion.ps1 y"
  Write-Host "      cambia la linea que dice IMPRESORA_POR_DEFECTO."
  Write-Host ""
}

# ── 2. Dejarlo en el arranque ────────────────────────────────────────────────
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
Write-Host "  [OK] Va a arrancar solo con Windows" -ForegroundColor Green

# ── 3. Arrancarlo ahora ──────────────────────────────────────────────────────
$yaEsta = $false
try {
  $r = Invoke-RestMethod -Uri 'http://localhost:9110/estado' -TimeoutSec 2
  $yaEsta = $r.ok -eq $true
} catch { }

if ($yaEsta) {
  Write-Host "  [OK] Ya estaba corriendo" -ForegroundColor Green
} else {
  Start-Process wscript.exe -ArgumentList "`"$lanzador`""
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-RestMethod -Uri 'http://localhost:9110/estado' -TimeoutSec 3
    if ($r.ok) { Write-Host "  [OK] Arrancado" -ForegroundColor Green }
  } catch {
    Write-Host "  [!] Arranco pero no contesta todavia. Proba de nuevo en unos segundos." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "  Listo. Abri la caja en el ERP y cobra una venta: la comanda"
Write-Host "  tiene que salir sola, sin que aparezca el cartel de imprimir."
Write-Host ""
Write-Host "  Si algo no anda, el detalle queda en:"
Write-Host "    $env:LOCALAPPDATA\RodzinyImpresion\agente.log"
Write-Host ""
Write-Host "  Para sacarlo del arranque, borra este archivo:"
Write-Host "    $lanzador"
Write-Host ""
Read-Host "  Enter para cerrar"
