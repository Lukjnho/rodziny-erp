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
# CÓMO SE USA: se deja corriendo (el instalador lo pone en el arranque). El ERP
# le habla a http://localhost:9110 y, si no contesta, sigue funcionando como
# hasta ahora con el diálogo del navegador. O sea que si el agente se cae, la
# caja NO se queda sin imprimir.
# ─────────────────────────────────────────────────────────────────────────────

# ── Lo que se puede tocar ────────────────────────────────────────────────────

# Nombre de la cola en Windows. Se ve con: Get-Printer
$IMPRESORA_POR_DEFECTO = 'POS-80'

# Puerto donde escucha. Si lo cambiás, cambialo también en el ERP.
$PUERTO = 9110

# Cuántos caracteres entran en un renglón. 48 es lo normal en 80 mm con la
# letra chica; si el ticket sale cortado o con mucho aire, es este número.
$ANCHO = 48

# Tabla de caracteres de la impresora, para que salgan las eñes y los acentos.
# 2 = PC850 (Europa occidental) en casi todas las térmicas chinas de 80 mm.
# Si salen símbolos raros en vez de "Ñoquis", probá con 16 (Windows-1252) o 0.
$TABLA_IMPRESORA = 2
$CODEPAGE_WINDOWS = 850

$LOG = Join-Path $env:LOCALAPPDATA 'RodzinyImpresion\agente.log'

# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

function Anotar([string]$mensaje) {
  try {
    $carpeta = Split-Path $LOG -Parent
    if (-not (Test-Path $carpeta)) { New-Item -ItemType Directory -Path $carpeta -Force | Out-Null }
    $marca = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -Path $LOG -Value "$marca  $mensaje" -Encoding utf8
  } catch {
    # el log nunca puede tumbar el agente
  }
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
# c = centrado · b = negrita · s = tamaño (1 normal, 2 doble, 3 triple) · i = sangría

$ENC = [System.Text.Encoding]::GetEncoding($CODEPAGE_WINDOWS)

function ConvertTo-EscPos($peticion) {
  $b = New-Object System.Collections.Generic.List[byte]

  function Crudo([byte[]]$bytes) { $b.AddRange($bytes) }
  function Texto([string]$s) { $b.AddRange($ENC.GetBytes($s)) }

  # Arranque: reinicia la impresora y elige la tabla de caracteres
  Crudo @(0x1B, 0x40)
  Crudo @(0x1B, 0x74, [byte]$TABLA_IMPRESORA)

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
      Texto ('-' * $ANCHO)
      Crudo @(0x0A)
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
      # ⚠️ LANDMINE: esta variable NO se puede llamar $ancho. PowerShell no
      # distingue mayúsculas de minúsculas, así que $ancho ES $ANCHO: se pisaba
      # el ancho del ticket para todo lo que viniera después. Con un TOTAL en
      # letra doble, el resto del ticket salía a 24 caracteres en vez de 48.
      $anchoRenglon = [int][Math]::Floor($ANCHO / $tam)
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

# ── El servidor ──────────────────────────────────────────────────────────────

function Responder($contexto, [int]$codigo, [string]$cuerpo) {
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

$escucha = New-Object System.Net.HttpListener
$escucha.Prefixes.Add("http://localhost:$PUERTO/")
$escucha.Prefixes.Add("http://127.0.0.1:$PUERTO/")

try {
  $escucha.Start()
} catch {
  Anotar "NO ARRANCO: $($_.Exception.Message)"
  Write-Host "No se pudo escuchar en el puerto $PUERTO. ¿Ya hay otro agente corriendo?"
  exit 1
}

Anotar "Agente arriba en el puerto $PUERTO (impresora por defecto: $IMPRESORA_POR_DEFECTO)"
Write-Host "Agente de impresion de Rodziny escuchando en http://localhost:$PUERTO"
Write-Host "Impresora: $IMPRESORA_POR_DEFECTO   ·   Log: $LOG"
Write-Host "Dejalo abierto. Para cortarlo, cerra esta ventana."

while ($escucha.IsListening) {
  try {
    $contexto = $escucha.GetContext()
    $pedido = $contexto.Request
    $ruta = $pedido.Url.AbsolutePath.TrimEnd('/')

    if ($pedido.HttpMethod -eq 'OPTIONS') {
      Responder $contexto 204 ''
      continue
    }

    if ($ruta -eq '/estado' -or $ruta -eq '') {
      $existe = $null -ne (Get-Printer -Name $IMPRESORA_POR_DEFECTO -ErrorAction SilentlyContinue)
      $cuerpo = @{ ok = $true; agente = 'rodziny'; version = 1;
                   impresora = $IMPRESORA_POR_DEFECTO; instalada = $existe } | ConvertTo-Json -Compress
      Responder $contexto 200 $cuerpo
      continue
    }

    # Vista previa: arma el ticket y devuelve cómo quedaría, SIN imprimir ni
    # gastar papel. Sirve para controlar que las eñes y los acentos salgan bien
    # y que las columnas cierren, antes de mandar nada a la impresora.
    if ($ruta -eq '/vista-previa' -and $pedido.HttpMethod -eq 'POST') {
      $lector = New-Object System.IO.StreamReader($pedido.InputStream, [System.Text.Encoding]::UTF8)
      $crudo = $lector.ReadToEnd()
      $lector.Close()

      $peticion = $crudo | ConvertFrom-Json
      $bytes = ConvertTo-EscPos $peticion

      # Se vuelve a leer con la MISMA tabla de caracteres de la impresora: si un
      # acento se rompió al codificar, acá se ve roto igual que en el papel.
      $comoSeVe = $ENC.GetString($bytes)
      $comoSeVe = [regex]::Replace($comoSeVe, '\x1B@|\x1Bt.|\x1Ba.|\x1DV..|\x1D!.|\x1BE.|\x1Bd.|\x1Bp...', '')

      Responder $contexto 200 (@{ ok = $true; bytes = $bytes.Length; papel = $comoSeVe } | ConvertTo-Json -Compress)
      continue
    }

    if ($ruta -eq '/imprimir' -and $pedido.HttpMethod -eq 'POST') {
      $lector = New-Object System.IO.StreamReader($pedido.InputStream, [System.Text.Encoding]::UTF8)
      $crudo = $lector.ReadToEnd()
      $lector.Close()

      $peticion = $crudo | ConvertFrom-Json
      $impresora = if ($peticion.impresora) { [string]$peticion.impresora } else { $IMPRESORA_POR_DEFECTO }
      $titulo = if ($peticion.titulo) { [string]$peticion.titulo } else { 'Rodziny' }

      $bytes = ConvertTo-EscPos $peticion
      $problema = [ImpresoraCruda]::Enviar($impresora, $bytes, $titulo)

      if ($problema) {
        Anotar "ERROR imprimiendo en '$impresora': $problema"
        Responder $contexto 500 (@{ ok = $false; error = $problema } | ConvertTo-Json -Compress)
      } else {
        Anotar "Impreso '$titulo' en '$impresora' ($($bytes.Length) bytes)"
        Responder $contexto 200 (@{ ok = $true; bytes = $bytes.Length } | ConvertTo-Json -Compress)
      }
      continue
    }

    Responder $contexto 404 (@{ ok = $false; error = 'ruta desconocida' } | ConvertTo-Json -Compress)
  } catch {
    # Un pedido mal formado no puede tumbar el agente: se anota y se sigue.
    Anotar "ERROR atendiendo un pedido: $($_.Exception.Message)"
    try { Responder $contexto 500 (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress) } catch {}
  }
}

