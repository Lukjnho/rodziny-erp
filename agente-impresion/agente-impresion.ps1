# ─────────────────────────────────────────────────────────────────────────────
# Agente de impresión de Rodziny
#
# Corre en la PC de la caja y hace UNA sola cosa: recibe el ticket del ERP y se
# lo manda a la impresora térmica en su propio idioma (ESC/POS). Con eso la
# comanda sale sola, sin el diálogo del navegador, corta el papel y —si está
# conectada— abre la gaveta.
#
# POR QUÉ HACE FALTA: el navegador no puede hablarle directo a una impresora
# térmica. Solo sabe "imprimir una página", que abre el diálogo y hay que
# confirmar cada vez. En un mostrador con 65 tickets por turno eso es inviable.
#
# QUÉ NO NECESITA: no instala nada. Es PowerShell, que ya viene con Windows, y
# usa la cola de impresión que ya está configurada ("Generic / Text Only").
#
# CÓMO SE CONFIGURA: NO se toca este archivo. Al arrancar por primera vez busca
# sola una impresora térmica y la guarda; y desde el ERP (Caja → Impresora) se
# puede elegir otra, ajustarla y hacer una prueba. La configuración es DE ESA
# PC: cada caja tiene la suya.
#
# CÓMO SE USA: se deja corriendo (el instalador lo pone en el arranque). El ERP
# le habla a http://localhost:9110 y, si no contesta, sigue funcionando como
# hasta ahora con el diálogo del navegador. O sea que si el agente se cae, la
# caja NO se queda sin imprimir.
# ─────────────────────────────────────────────────────────────────────────────

$PUERTO = 9110

$CARPETA = Join-Path $env:LOCALAPPDATA 'RodzinyImpresion'
$CONFIG = Join-Path $CARPETA 'config.json'
$LOG = Join-Path $CARPETA 'agente.log'

$ErrorActionPreference = 'Stop'

# ── Configuración ────────────────────────────────────────────────────────────
# Vive en un archivo aparte, no acá adentro: así se cambia desde el ERP sin
# tocar el script ni tener que copiar un archivo distinto a cada PC.

# Tabla de caracteres de la impresora → página de códigos de Windows.
# Es lo que hace que salgan las eñes y los acentos en vez de símbolos raros.
$TABLAS = @{
  0  = @{ windows = 437;  nombre = 'PC437 (Estados Unidos)' }
  2  = @{ windows = 850;  nombre = 'PC850 (Europa occidental)' }
  16 = @{ windows = 1252; nombre = 'Windows-1252 (Latin 1)' }
  19 = @{ windows = 858;  nombre = 'PC858 (Europa con simbolo del euro)' }
}

$script:cfg = @{ impresora = ''; ancho = 48; tabla = 2 }

function Anotar([string]$mensaje) {
  try {
    if (-not (Test-Path $CARPETA)) { New-Item -ItemType Directory -Path $CARPETA -Force | Out-Null }
    Add-Content -Path $LOG -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $mensaje) -Encoding utf8
  } catch { }
}

function Get-Impresoras {
  # Marca como "probable" a la que tiene pinta de térmica, para poder sugerirla
  # sin obligar a nadie a saber cuál es cuál.
  $predeterminada = ''
  try {
    $d = Get-CimInstance -ClassName Win32_Printer -Filter 'Default = True' -ErrorAction SilentlyContinue
    if ($d) { $predeterminada = $d.Name }
  } catch { }

  Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
    $texto = "$($_.Name) $($_.DriverName)"
    $probable = $texto -match '(?i)pos.?80|thermal|t[eé]rmic|EML|XP-?\d|receipt|ticket|Generic / Text Only'
    # Las de Windows que nunca son una térmica
    $falsa = $_.Name -match '(?i)OneNote|XPS|Print to PDF|Fax|DeskJet|LaserJet|Send To'
    [pscustomobject]@{
      nombre         = $_.Name
      driver         = $_.DriverName
      puerto         = $_.PortName
      probable       = ($probable -and -not $falsa)
      predeterminada = ($_.Name -eq $predeterminada)
    }
  }
}

function Write-Config {
  if (-not (Test-Path $CARPETA)) { New-Item -ItemType Directory -Path $CARPETA -Force | Out-Null }
  ($script:cfg | ConvertTo-Json) | Set-Content -Path $CONFIG -Encoding UTF8
}

function Read-Config {
  if (Test-Path $CONFIG) {
    try {
      $guardada = Get-Content $CONFIG -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($guardada.impresora) { $script:cfg.impresora = [string]$guardada.impresora }
      if ($guardada.ancho) { $script:cfg.ancho = [int]$guardada.ancho }
      if ($null -ne $guardada.tabla) { $script:cfg.tabla = [int]$guardada.tabla }
      Anotar "Configuracion leida: impresora='$($script:cfg.impresora)' ancho=$($script:cfg.ancho) tabla=$($script:cfg.tabla)"
      return
    } catch {
      Anotar "No se pudo leer la configuracion, se busca una impresora sola: $($_.Exception.Message)"
    }
  }

  # Primera vez en esta PC: elegir sola la que tenga pinta de térmica.
  $candidata = Get-Impresoras | Where-Object { $_.probable } | Select-Object -First 1
  if ($candidata) {
    $script:cfg.impresora = $candidata.nombre
    Anotar "Primera vez: se eligio sola la impresora '$($candidata.nombre)'"
    Write-Config
  } else {
    Anotar 'Primera vez: no se encontro ninguna impresora termica. Hay que elegirla desde el ERP.'
  }
}

function Get-CodepageWindows {
  $t = $TABLAS[[int]$script:cfg.tabla]
  if ($t) { return $t.windows }
  return 850
}

# ── Mandarle bytes crudos a la impresora ─────────────────────────────────────
# Windows no tiene forma de hacer esto desde PowerShell "a secas": hay que
# pedírselo a la cola de impresión con el tipo de dato RAW, que es el que pasa
# los bytes tal cual sin que el driver los interprete.

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class ImpresoraCruda
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinterW(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinterW(IntPtr hPrinter, int level,
        [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    /// <summary>Devuelve null si salio bien, o el motivo si fallo.</summary>
    public static string Enviar(string impresora, byte[] datos, string titulo)
    {
        IntPtr h;
        if (!OpenPrinterW(impresora, out h, IntPtr.Zero))
            return "No se pudo abrir la impresora '" + impresora + "' (codigo " + Marshal.GetLastWin32Error() + ")";
        try
        {
            DOCINFOW di = new DOCINFOW();
            di.pDocName = titulo;
            di.pDataType = "RAW";
            if (!StartDocPrinterW(h, 1, di))
                return "No se pudo empezar el trabajo (codigo " + Marshal.GetLastWin32Error() + ")";
            try
            {
                if (!StartPagePrinter(h))
                    return "No se pudo empezar la pagina (codigo " + Marshal.GetLastWin32Error() + ")";
                IntPtr p = Marshal.AllocCoTaskMem(datos.Length);
                try
                {
                    Marshal.Copy(datos, 0, p, datos.Length);
                    int escritos;
                    if (!WritePrinter(h, p, datos.Length, out escritos))
                        return "No se pudo escribir en la impresora (codigo " + Marshal.GetLastWin32Error() + ")";
                    if (escritos != datos.Length)
                        return "Se escribieron " + escritos + " de " + datos.Length + " bytes";
                }
                finally { Marshal.FreeCoTaskMem(p); }
                EndPagePrinter(h);
            }
            finally { EndDocPrinter(h); }
        }
        finally { ClosePrinter(h); }
        return null;
    }
}
'@

# ── Armar el ticket en ESC/POS ───────────────────────────────────────────────
#
# El ERP manda una lista de renglones y el agente los traduce. La idea es que el
# DISEÑO del ticket viva en el ERP (que se actualiza solo con cada deploy) y acá
# quede nada más que la traducción, que no cambia nunca. Así no hay que volver a
# instalar el agente en cada PC cada vez que se toca el ticket.
#
# Cada renglón es uno de estos:
#   { "k": "t",  "x": "RODZINY", "c": true, "b": true, "s": 2 }   texto
#   { "k": "lr", "x": "TOTAL", "y": "$1.500", "b": true }         izquierda y derecha
#   { "k": "sep" }                                                linea de guiones
#   { "k": "nl" }                                                 renglon en blanco
#   { "k": "qr",  "x": "https://..." }                            codigo QR
# c = centrado · b = negrita · s = tamaño (1 normal, 2 doble, 3 triple) · i = sangría

function ConvertTo-EscPos($peticion) {
  $b = New-Object System.Collections.Generic.List[byte]
  $enc = [System.Text.Encoding]::GetEncoding((Get-CodepageWindows))
  $anchoTicket = [int]$script:cfg.ancho

  function Crudo([byte[]]$bytes) { $b.AddRange($bytes) }
  function Texto([string]$s) { $b.AddRange($enc.GetBytes($s)) }

  # Arranque: reinicia la impresora y elige la tabla de caracteres
  Crudo @(0x1B, 0x40)
  Crudo @(0x1B, 0x74, [byte][int]$script:cfg.tabla)

  foreach ($r in $peticion.lineas) {
    $tipo = if ($r.k) { [string]$r.k } else { 't' }

    # ⚠️ El separador y el renglón en blanco APAGAN la letra doble y la negrita
    # antes de dibujarse. Si no, heredan el tamaño del renglón anterior: después
    # de un TOTAL en letra grande, la línea de guiones salía al doble de ancho y
    # se iba del papel.
    if ($tipo -eq 'nl') {
      Crudo @(0x1D, 0x21, 0x00)
      Crudo @(0x1B, 0x45, 0x00)
      Crudo @(0x0A)
      continue
    }

    if ($tipo -eq 'sep') {
      Crudo @(0x1B, 0x61, 0x00)          # alineado a la izquierda
      Crudo @(0x1D, 0x21, 0x00)          # letra normal
      Crudo @(0x1B, 0x45, 0x00)          # sin negrita
      Texto ('-' * $anchoTicket)
      Crudo @(0x0A)
      continue
    }

    # Codigo QR, dibujado por la impresora con su propio comando (no como
    # imagen): sale nitido y viajan solo los caracteres de la URL.
    # Lo usa el comprobante fiscal, donde el QR es obligatorio.
    if ($tipo -eq 'qr') {
      $textoQr = [string]$r.x
      if (-not $textoQr) { continue }
      # La URL de ARCA es ASCII (base64 y signos): no pasa por la tabla de
      # caracteres de la impresora, que es para el texto del ticket.
      $datosQr = [System.Text.Encoding]::ASCII.GetBytes($textoQr)
      $largo = $datosQr.Length + 3
      $pL = [byte]($largo % 256)
      $pH = [byte]([Math]::Floor($largo / 256))

      Crudo @(0x1B, 0x61, 0x01)                              # centrado
      Crudo @(0x1D, 0x21, 0x00)                              # letra normal
      Crudo @(0x1B, 0x45, 0x00)                              # sin negrita
      Crudo @(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)  # modelo 2
      Crudo @(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x05)        # tamaño del punto
      # Correccion L a proposito: la URL es larga y con mas correccion entran
      # mas cuadraditos, que en una termica de 203 dpi se leen peor.
      Crudo @(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30)
      Crudo @(0x1D, 0x28, 0x6B, $pL, $pH, 0x31, 0x50, 0x30)          # cargar datos
      Crudo $datosQr
      Crudo @(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30)        # imprimirlo
      Crudo @(0x0A)
      Crudo @(0x1B, 0x61, 0x00)                              # volver a la izquierda
      continue
    }

    # alineación
    $alineacion = if ($r.c) { 0x01 } else { 0x00 }
    Crudo @(0x1B, 0x61, [byte]$alineacion)

    # tamaño: GS ! con el ancho en los 4 bits de arriba y el alto en los de abajo
    $tam = if ($r.s) { [int]$r.s } else { 1 }
    if ($tam -lt 1) { $tam = 1 }
    if ($tam -gt 4) { $tam = 4 }
    $n = ((($tam - 1) -shl 4) -bor ($tam - 1))
    Crudo @(0x1D, 0x21, [byte]$n)

    # negrita
    $negrita = if ($r.b) { 0x01 } else { 0x00 }
    Crudo @(0x1B, 0x45, [byte]$negrita)

    $sangria = if ($r.i) { [int]$r.i } else { 0 }
    $izq = (' ' * $sangria) + [string]$r.x

    if ($tipo -eq 'lr') {
      # Con letra doble entran la mitad de caracteres por renglón.
      #
      # ⚠️ LANDMINE: PowerShell NO distingue mayúsculas de minúsculas, así que
      # esta variable no puede llamarse igual que el ancho del ticket. Cuando el
      # ancho global se llamaba $ANCHO, este cálculo lo pisaba: después de un
      # TOTAL en letra doble, el resto del ticket salía a 24 caracteres.
      $anchoRenglon = [int][Math]::Floor($anchoTicket / $tam)
      $der = [string]$r.y
      $espacio = $anchoRenglon - $der.Length
      if ($espacio -lt 1) { $espacio = 1 }
      if ($izq.Length -gt ($espacio - 1)) { $izq = $izq.Substring(0, [Math]::Max(0, $espacio - 1)) }
      $relleno = $anchoRenglon - $izq.Length - $der.Length
      if ($relleno -lt 1) { $relleno = 1 }
      Texto ($izq + (' ' * $relleno) + $der)
    } else {
      Texto $izq
    }

    Crudo @(0x0A)
  }

  # Apagar todo lo que quedó prendido, dar aire y cortar
  Crudo @(0x1B, 0x45, 0x00)
  Crudo @(0x1D, 0x21, 0x00)
  Crudo @(0x1B, 0x61, 0x00)

  if ($peticion.gaveta) { Crudo @(0x1B, 0x70, 0x00, 0x19, 0xFA) }

  if ($peticion.cortar -ne $false) {
    Crudo @(0x1B, 0x64, 0x04)            # 4 renglones de aire
    Crudo @(0x1D, 0x56, 0x42, 0x00)      # corte parcial
  }

  return $b.ToArray()
}

function New-TicketDePrueba {
  # La regla numerada es la clave: si NO entra justa en un renglón, el ancho
  # configurado está mal. Es la forma de calibrar sin adivinar.
  $regla = ''
  for ($i = 1; $i -le [int]$script:cfg.ancho; $i++) { $regla += ($i % 10) }

  return @{
    titulo = 'Prueba de impresora'
    cortar = $true
    lineas = @(
      @{ x = 'RODZINY'; c = $true; b = $true; s = 2 },
      @{ x = 'Prueba de impresora'; c = $true },
      @{ k = 'sep' },
      @{ x = "Impresora: $($script:cfg.impresora)" },
      @{ x = "Ancho: $($script:cfg.ancho) caracteres" },
      @{ x = "Tabla: $($script:cfg.tabla)" },
      @{ k = 'sep' },
      @{ x = 'Tiene que entrar justo, sin cortarse:' },
      @{ x = $regla },
      @{ k = 'sep' },
      @{ x = 'Acentos y enies:' },
      @{ x = 'Ñoquis - Jamón - Menú del día - ¡Gracias!' },
      @{ k = 'sep' },
      @{ x = 'Letra normal' },
      @{ x = 'Letra doble'; s = 2 },
      @{ x = 'Negrita'; b = $true },
      @{ k = 'sep' },
      @{ k = 'lr'; x = 'TOTAL'; y = '$27.000'; b = $true; s = 2 },
      @{ k = 'sep' },
      @{ x = 'Si leiste todo esto, esta lista.'; c = $true }
    )
  }
}

# ── El servidor ──────────────────────────────────────────────────────────────

function Send-Respuesta($contexto, [int]$codigo, [string]$cuerpo) {
  $resp = $contexto.Response
  $resp.StatusCode = $codigo
  $resp.ContentType = 'application/json; charset=utf-8'
  # El ERP se sirve por https y el agente por http en la propia PC. El navegador
  # lo permite porque localhost es de confianza, pero exige estos permisos.
  $resp.Headers.Add('Access-Control-Allow-Origin', '*')
  $resp.Headers.Add('Access-Control-Allow-Headers', 'content-type')
  $resp.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  $resp.Headers.Add('Access-Control-Allow-Private-Network', 'true')
  $resp.Headers.Add('Access-Control-Max-Age', '86400')
  $datos = [System.Text.Encoding]::UTF8.GetBytes($cuerpo)
  $resp.ContentLength64 = $datos.Length
  $resp.OutputStream.Write($datos, 0, $datos.Length)
  $resp.OutputStream.Close()
}

function Read-Cuerpo($pedido) {
  $lector = New-Object System.IO.StreamReader($pedido.InputStream, [System.Text.Encoding]::UTF8)
  $crudo = $lector.ReadToEnd()
  $lector.Close()
  if (-not $crudo) { return $null }
  return $crudo | ConvertFrom-Json
}

function Send-ALaImpresora($peticion, [string]$titulo) {
  $impresora = if ($peticion -and $peticion.impresora) { [string]$peticion.impresora } else { [string]$script:cfg.impresora }
  if (-not $impresora) {
    return @{ ok = $false; error = 'Todavia no hay ninguna impresora elegida. Configurala desde el ERP, en Caja -> Impresora.' }
  }
  $bytes = ConvertTo-EscPos $peticion
  $problema = [ImpresoraCruda]::Enviar($impresora, $bytes, $titulo)
  if ($problema) {
    Anotar "ERROR imprimiendo en '$impresora': $problema"
    return @{ ok = $false; error = $problema }
  }
  Anotar "Impreso '$titulo' en '$impresora' ($($bytes.Length) bytes)"
  return @{ ok = $true; bytes = $bytes.Length }
}

Read-Config

$escucha = New-Object System.Net.HttpListener
$escucha.Prefixes.Add("http://localhost:$PUERTO/")

try {
  $escucha.Start()
} catch {
  Anotar "NO ARRANCO: $($_.Exception.Message)"
  Write-Host "No se pudo escuchar en el puerto $PUERTO. Puede que ya haya otro agente corriendo."
  exit 1
}

Anotar "Agente arriba en el puerto $PUERTO (impresora: '$($script:cfg.impresora)')"
Write-Host "Agente de impresion de Rodziny escuchando en http://localhost:$PUERTO"
Write-Host "Impresora: $($script:cfg.impresora)   .   Log: $LOG"
Write-Host "Se configura desde el ERP, en Caja -> Impresora. Dejalo abierto."

while ($escucha.IsListening) {
  $contexto = $null
  try {
    $contexto = $escucha.GetContext()
    $pedido = $contexto.Request
    $ruta = $pedido.Url.AbsolutePath.TrimEnd('/')

    if ($pedido.HttpMethod -eq 'OPTIONS') { Send-Respuesta $contexto 204 ''; continue }

    # ── Cómo está ─────────────────────────────────────────────────────────────
    if ($ruta -eq '/estado' -or $ruta -eq '') {
      $existe = $false
      if ($script:cfg.impresora) {
        $existe = $null -ne (Get-Printer -Name $script:cfg.impresora -ErrorAction SilentlyContinue)
      }
      $cuerpo = @{
        ok        = $true
        agente    = 'rodziny'
        version   = 2
        impresora = $script:cfg.impresora
        instalada = $existe
        ancho     = $script:cfg.ancho
        tabla     = $script:cfg.tabla
      } | ConvertTo-Json -Compress
      Send-Respuesta $contexto 200 $cuerpo
      continue
    }

    # ── Qué impresoras hay en esta PC ─────────────────────────────────────────
    if ($ruta -eq '/impresoras') {
      $lista = @(Get-Impresoras)
      $tablas = @($TABLAS.Keys | Sort-Object | ForEach-Object {
          @{ valor = $_; nombre = $TABLAS[$_].nombre }
        })
      Send-Respuesta $contexto 200 (@{ ok = $true; impresoras = $lista; tablas = $tablas } | ConvertTo-Json -Compress -Depth 4)
      continue
    }

    # ── Elegir impresora ──────────────────────────────────────────────────────
    if ($ruta -eq '/config' -and $pedido.HttpMethod -eq 'POST') {
      $peticion = Read-Cuerpo $pedido
      if ($peticion.impresora) {
        $existe = $null -ne (Get-Printer -Name ([string]$peticion.impresora) -ErrorAction SilentlyContinue)
        if (-not $existe) {
          Send-Respuesta $contexto 400 (@{ ok = $false; error = "En esta PC no hay ninguna impresora llamada '$($peticion.impresora)'." } | ConvertTo-Json -Compress)
          continue
        }
        $script:cfg.impresora = [string]$peticion.impresora
      }
      if ($peticion.ancho) { $script:cfg.ancho = [int]$peticion.ancho }
      if ($null -ne $peticion.tabla) { $script:cfg.tabla = [int]$peticion.tabla }
      Write-Config
      Anotar "Configuracion guardada desde el ERP: impresora='$($script:cfg.impresora)' ancho=$($script:cfg.ancho) tabla=$($script:cfg.tabla)"
      Send-Respuesta $contexto 200 (@{ ok = $true; impresora = $script:cfg.impresora; ancho = $script:cfg.ancho; tabla = $script:cfg.tabla } | ConvertTo-Json -Compress)
      continue
    }

    # ── Imprimir una prueba ───────────────────────────────────────────────────
    if ($ruta -eq '/prueba' -and $pedido.HttpMethod -eq 'POST') {
      $resultado = Send-ALaImpresora (New-TicketDePrueba) 'Prueba de impresora'
      $codigo = 500
      if ($resultado.ok) { $codigo = 200 }
      Send-Respuesta $contexto $codigo ($resultado | ConvertTo-Json -Compress)
      continue
    }

    # ── Vista previa, sin gastar papel ────────────────────────────────────────
    if ($ruta -eq '/vista-previa' -and $pedido.HttpMethod -eq 'POST') {
      # Sin renglones se muestra el ticket de prueba: es la forma de calibrar el
      # ancho y los acentos sin gastar papel.
      $peticion = Read-Cuerpo $pedido
      if (-not $peticion -or -not $peticion.lineas) { $peticion = New-TicketDePrueba }
      $bytes = ConvertTo-EscPos $peticion
      # Se vuelve a leer con la MISMA tabla de la impresora: si un acento se
      # rompió al codificar, acá se ve roto igual que en el papel.
      $enc = [System.Text.Encoding]::GetEncoding((Get-CodepageWindows))
      $comoSeVe = $enc.GetString($bytes)
      $comoSeVe = [regex]::Replace($comoSeVe, '\x1B@|\x1Bt.|\x1Ba.|\x1DV..|\x1D!.|\x1BE.|\x1Bd.|\x1Bp...', '')
      # El QR son cinco comandos seguidos, y en el del medio viaja la URL entera.
      # Sin esto, la vista previa vuelca 300 caracteres de base64 y no se
      # entiende nada de lo que rodea al codigo.
      $comoSeVe = [regex]::Replace(
        $comoSeVe,
        '\x1D\(k[\s\S]{2}1A[\s\S]{2}[\s\S]*?\x1D\(k[\s\S]{2}1Q0',
        '[ CODIGO QR ]')
      Send-Respuesta $contexto 200 (@{ ok = $true; bytes = $bytes.Length; papel = $comoSeVe } | ConvertTo-Json -Compress)
      continue
    }

    # ── Imprimir de verdad ────────────────────────────────────────────────────
    if ($ruta -eq '/imprimir' -and $pedido.HttpMethod -eq 'POST') {
      $peticion = Read-Cuerpo $pedido
      $titulo = if ($peticion.titulo) { [string]$peticion.titulo } else { 'Rodziny' }
      $resultado = Send-ALaImpresora $peticion $titulo
      $codigo = 500
      if ($resultado.ok) { $codigo = 200 }
      Send-Respuesta $contexto $codigo ($resultado | ConvertTo-Json -Compress)
      continue
    }

    Send-Respuesta $contexto 404 (@{ ok = $false; error = 'ruta desconocida' } | ConvertTo-Json -Compress)
  } catch {
    # Un pedido mal formado no puede tumbar el agente: se anota y se sigue.
    Anotar "ERROR atendiendo un pedido: $($_.Exception.Message)"
    if ($contexto) {
      try { Send-Respuesta $contexto 500 (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress) } catch { }
    }
  }
}
