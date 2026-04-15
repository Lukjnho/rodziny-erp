import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { TOLERANCIA_MIN, ymd, hhmm, diffMinutosVsHorario } from './utils'

// ─── Configuración editable ─────────────────────────────────────────────────
// Si en el local detectás que las coordenadas no son exactas, ajustalas acá
const LOCALES = {
  vedia:    { nombre: 'Rodziny Vedia',    lat: -27.45042, lng: -58.98962 },
  saavedra: { nombre: 'Rodziny Saavedra', lat: -27.44856, lng: -58.97886 },
} as const
const RADIO_METROS = 50
const FOTO_MAX_LADO = 640        // px
const FOTO_QUALITY  = 0.7

type LocalKey = keyof typeof LOCALES

interface Empleado {
  id: string
  nombre: string
  apellido: string
  dni: string
  local: 'vedia' | 'saavedra' | 'ambos'
  pin_fichaje: string | null
  horario_tipo: 'fijo' | 'flexible'
  horas_semanales_requeridas: number | null
}

interface Cronograma {
  id: string
  empleado_id: string
  fecha: string
  hora_entrada: string | null
  hora_salida: string | null
  es_franco: boolean
  publicado: boolean
}

interface Fichada {
  id: string
  empleado_id: string
  fecha: string
  tipo: 'entrada' | 'salida'
  timestamp: string
  local: string
  minutos_diferencia: number | null
  foto_path: string | null
}

// ─── Helpers locales (los compartidos vienen de ./utils) ────────────────────
function haversineMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function detectarLocal(lat: number, lng: number): { key: LocalKey; distancia: number } | null {
  const candidatos = (Object.keys(LOCALES) as LocalKey[]).map((key) => ({
    key,
    distancia: haversineMetros(lat, lng, LOCALES[key].lat, LOCALES[key].lng),
  }))
  candidatos.sort((a, b) => a.distancia - b.distancia)
  const mejor = candidatos[0]
  if (mejor.distancia <= RADIO_METROS) return mejor
  return null
}

async function comprimirImagen(blob: Blob): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const i = new Image()
    i.onload = () => { URL.revokeObjectURL(url); resolve(i) }
    i.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    i.src = url
  })
  const escala = Math.min(1, FOTO_MAX_LADO / Math.max(img.width, img.height))
  const w = Math.round(img.width * escala)
  const h = Math.round(img.height * escala)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falló'))), 'image/jpeg', FOTO_QUALITY)
  })
}

// LocalStorage helpers
const LS_KEY = 'rodziny_fichaje_empleado'
function guardarSesion(empleadoId: string) {
  localStorage.setItem(LS_KEY, JSON.stringify({ id: empleadoId, ts: Date.now() }))
}
function leerSesion(): string | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Expira a los 30 días
    if (Date.now() - parsed.ts > 30 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(LS_KEY)
      return null
    }
    return parsed.id
  } catch {
    return null
  }
}

// ─── Componente principal ───────────────────────────────────────────────────
export function FicharPage() {
  const [empleado, setEmpleado] = useState<Empleado | null>(null)
  const [cargando, setCargando] = useState(true)

  // Auto-login si hay sesión guardada
  useEffect(() => {
    const id = leerSesion()
    if (!id) { setCargando(false); return }
    supabase.from('empleados').select('*').eq('id', id).single().then(({ data }) => {
      if (data) setEmpleado(data as Empleado)
      setCargando(false)
    })
  }, [])

  if (cargando) {
    return <Pantalla><p className="text-gray-500 text-sm">Cargando...</p></Pantalla>
  }

  if (!empleado) {
    return <Login onLogin={(emp) => { guardarSesion(emp.id); setEmpleado(emp) }} />
  }

  return <Home empleado={empleado} onLogout={() => { localStorage.removeItem(LS_KEY); setEmpleado(null) }} />
}

// ─── Layout base ────────────────────────────────────────────────────────────
function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-rodziny-800 text-white px-4 py-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold bg-rodziny-600">R</div>
        <span className="font-semibold text-sm">Rodziny · Fichaje</span>
      </header>
      <main className="flex-1 p-4 max-w-md w-full mx-auto">{children}</main>
    </div>
  )
}

// ─── Login ──────────────────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: (e: Empleado) => void }) {
  const [dni, setDni] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setError(null)
    if (!dni || !pin) { setError('Completá DNI y PIN'); return }
    setLoading(true)
    const { data, error: dbError } = await supabase
      .from('empleados')
      .select('*')
      .eq('dni', dni.trim())
      .eq('activo', true)
      .maybeSingle()
    setLoading(false)
    if (dbError || !data) { setError('DNI no encontrado'); return }
    if (!data.pin_fichaje) { setError('Tu PIN no está configurado. Avisá a RRHH'); return }
    if (data.pin_fichaje !== pin.trim()) { setError('PIN incorrecto'); return }
    onLogin(data as Empleado)
  }

  return (
    <Pantalla>
      <div className="bg-white rounded-lg border border-gray-200 p-5 mt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Ingresar</h2>
        <p className="text-xs text-gray-500 mb-4">Tu DNI y un PIN de 4 dígitos que te dio RRHH</p>

        <label className="block text-xs font-medium text-gray-700 mb-1">DNI</label>
        <input
          type="tel"
          inputMode="numeric"
          value={dni}
          onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3"
          placeholder="Sin puntos"
        />

        <label className="block text-xs font-medium text-gray-700 mb-1">PIN</label>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 tracking-widest"
          placeholder="••••"
        />

        {error && <div className="text-xs text-red-600 mb-3">{error}</div>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-rodziny-700 hover:bg-rodziny-800 text-white py-2.5 rounded font-medium text-sm disabled:opacity-50"
        >
          {loading ? 'Verificando...' : 'Ingresar'}
        </button>
      </div>
    </Pantalla>
  )
}

// ─── Home (logueado) ────────────────────────────────────────────────────────
type Vista = 'inicio' | 'fichando' | 'mis_horarios' | 'mi_quincena'

function Home({ empleado, onLogout }: { empleado: Empleado; onLogout: () => void }) {
  const [vista, setVista] = useState<Vista>('inicio')
  const [refrescador, setRefrescador] = useState(0)

  return (
    <Pantalla>
      <div className="bg-white rounded-lg border border-gray-200 p-4 mt-2 mb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500">Hola</p>
            <p className="text-base font-semibold text-gray-900">{empleado.nombre} {empleado.apellido}</p>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-500 hover:text-red-600 underline">Salir</button>
        </div>
      </div>

      {vista === 'inicio' && (
        <Inicio
          empleado={empleado}
          key={refrescador}
          onIrAFichar={() => setVista('fichando')}
          onIrAHorarios={() => setVista('mis_horarios')}
          onIrAQuincena={() => setVista('mi_quincena')}
        />
      )}
      {vista === 'fichando' && (
        <Fichando
          empleado={empleado}
          onCancelar={() => setVista('inicio')}
          onListo={() => { setRefrescador((x) => x + 1); setVista('inicio') }}
        />
      )}
      {vista === 'mis_horarios' && (
        <MisHorarios empleado={empleado} onVolver={() => setVista('inicio')} />
      )}
      {vista === 'mi_quincena' && (
        <MiQuincena empleado={empleado} onVolver={() => setVista('inicio')} />
      )}
    </Pantalla>
  )
}

// ─── Inicio ─────────────────────────────────────────────────────────────────
function Inicio({ empleado, onIrAFichar, onIrAHorarios, onIrAQuincena }: {
  empleado: Empleado
  onIrAFichar: () => void
  onIrAHorarios: () => void
  onIrAQuincena: () => void
}) {
  const [crono, setCrono] = useState<Cronograma | null>(null)
  const [fichadasHoy, setFichadasHoy] = useState<Fichada[]>([])
  const [debugInfo, setDebugInfo] = useState<string>('')
  const ahoraDev = new Date()
  const hoy = ymd(ahoraDev)
  const debugOn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: f }] = await Promise.all([
        supabase.from('cronograma').select('*').eq('empleado_id', empleado.id).eq('fecha', hoy).maybeSingle(),
        supabase.from('fichadas').select('*').eq('empleado_id', empleado.id).eq('fecha', hoy).order('timestamp'),
      ])
      setCrono((c as Cronograma) || null)
      setFichadasHoy((f as Fichada[]) || [])

      if (debugOn) {
        // Traer los próximos 14 días publicados para diagnóstico
        const hastaDt = new Date(ahoraDev); hastaDt.setDate(hastaDt.getDate() + 14)
        const { data: prox, error: proxErr } = await supabase
          .from('cronograma')
          .select('fecha, hora_entrada, hora_salida, publicado')
          .eq('empleado_id', empleado.id)
          .eq('publicado', true)
          .gte('fecha', hoy)
          .lte('fecha', ymd(hastaDt))
          .order('fecha')
        // Traer TODOS los días (sin filtro publicado) para comparar
        const { data: todos } = await supabase
          .from('cronograma')
          .select('fecha, publicado')
          .eq('empleado_id', empleado.id)
          .gte('fecha', hoy)
          .lte('fecha', ymd(hastaDt))
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const offset = -ahoraDev.getTimezoneOffset() / 60
        setDebugInfo(JSON.stringify({
          empleado_id: empleado.id,
          empleado_nombre: `${empleado.nombre} ${empleado.apellido}`,
          dni: empleado.dni,
          hoy_device: hoy,
          ahora_iso: ahoraDev.toISOString(),
          tz,
          offset_hs: offset,
          crono_hoy: c ? { fecha: (c as any).fecha, he: (c as any).hora_entrada, hs: (c as any).hora_salida, pub: (c as any).publicado } : null,
          prox14_pub: prox?.length ?? 0,
          prox14_todos: todos?.length ?? 0,
          primera_pub: prox?.[0] ?? null,
          err: proxErr?.message ?? null,
        }, null, 2))
      }
    })()
  }, [empleado.id, hoy, debugOn])

  const proximoTipo: 'entrada' | 'salida' = fichadasHoy.length % 2 === 0 ? 'entrada' : 'salida'

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-3">
        <p className="text-xs text-gray-500 mb-1">Tu turno hoy</p>
        {crono?.es_franco ? (
          <p className="text-base font-semibold text-blue-700">FRANCO</p>
        ) : crono?.hora_entrada ? (
          <p className="text-base font-semibold text-gray-900">
            {crono.hora_entrada} – {crono.hora_salida}
          </p>
        ) : (
          <p className="text-sm text-gray-500">No tenés turno asignado hoy</p>
        )}
        {crono && !crono.publicado && (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-[11px] text-amber-800">
            ⚠️ Tu horario todavía está en <strong>borrador</strong> (sin publicar por el encargado). Podés fichar igual, pero sin horario de referencia.
          </div>
        )}
      </div>

      {fichadasHoy.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-3 mb-3 text-xs text-gray-700">
          <p className="font-medium mb-1">Fichajes de hoy:</p>
          {fichadasHoy.map((f) => (
            <div key={f.id} className="flex justify-between">
              <span className="capitalize">{f.tipo}</span>
              <span>{hhmm(new Date(f.timestamp))}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onIrAFichar}
        className="w-full bg-rodziny-700 hover:bg-rodziny-800 text-white py-4 rounded-lg font-semibold text-base mb-3 shadow"
      >
        FICHAR {proximoTipo.toUpperCase()}
      </button>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onIrAHorarios} className="bg-white border border-gray-200 rounded-lg py-3 text-xs text-gray-700 hover:bg-gray-50">
          Mis horarios
        </button>
        <button onClick={onIrAQuincena} className="bg-white border border-gray-200 rounded-lg py-3 text-xs text-gray-700 hover:bg-gray-50">
          Mi quincena
        </button>
      </div>

      {debugOn && debugInfo && (
        <pre className="mt-4 p-2 bg-gray-900 text-green-300 text-[10px] rounded overflow-x-auto whitespace-pre-wrap break-all">
          {debugInfo}
        </pre>
      )}
    </>
  )
}

// ─── Flujo de fichaje ───────────────────────────────────────────────────────
type PasoFichaje = 'gps' | 'foto' | 'subiendo' | 'ok' | 'error'

function Fichando({ empleado, onCancelar, onListo }: {
  empleado: Empleado
  onCancelar: () => void
  onListo: () => void
}) {
  const [paso, setPaso] = useState<PasoFichaje>('gps')
  const [mensaje, setMensaje] = useState<string>('Detectando ubicación...')
  const [localDetectado, setLocalDetectado] = useState<LocalKey | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ tipo: string; minutos: number | null } | null>(null)

  // Paso 1: GPS
  useEffect(() => {
    if (paso !== 'gps') return

    // Modo dev: bypass GPS, simula Vedia
    if (import.meta.env.DEV) {
      const v = LOCALES.vedia
      setCoords({ lat: v.lat, lng: v.lng })
      setLocalDetectado('vedia')
      setMensaje('Modo dev: ubicación simulada (Vedia)')
      setPaso('foto')
      return
    }

    if (!navigator.geolocation) {
      setMensaje('Tu navegador no soporta GPS')
      setPaso('error')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setCoords({ lat: latitude, lng: longitude })
        const det = detectarLocal(latitude, longitude)
        if (!det) {
          setMensaje('No estás dentro del radio de ningún local. Acercate a la entrada o avisá a RRHH.')
          setPaso('error')
          return
        }
        setLocalDetectado(det.key)
        setMensaje(`Detectado: ${LOCALES[det.key].nombre} (${Math.round(det.distancia)}m)`)
        setPaso('foto')
      },
      (err) => {
        setMensaje(`Error de GPS: ${err.message}. Activá la ubicación.`)
        setPaso('error')
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }, [paso])

  // Paso 2: cámara
  useEffect(() => {
    if (paso !== 'foto') return
    let cancelado = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelado) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
      } catch (e: any) {
        setMensaje('No pude acceder a la cámara: ' + (e?.message || e))
        setPaso('error')
      }
    })()
    return () => {
      cancelado = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [paso])

  function tomarFoto() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        setFotoBlob(blob)
        setFotoPreview(URL.createObjectURL(blob))
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      },
      'image/jpeg',
      0.85
    )
  }

  async function confirmarFichaje() {
    if (!fotoBlob || !localDetectado || !coords) return
    setPaso('subiendo')
    setMensaje('Guardando...')
    try {
      const ahora = new Date()
      const fecha = ymd(ahora)

      // Determinar tipo (entrada o salida)
      const { data: yaHoy } = await supabase
        .from('fichadas')
        .select('id')
        .eq('empleado_id', empleado.id)
        .eq('fecha', fecha)
      const tipo: 'entrada' | 'salida' = (yaHoy?.length ?? 0) % 2 === 0 ? 'entrada' : 'salida'

      // Cronograma del día (para diferencia)
      const { data: crono } = await supabase
        .from('cronograma')
        .select('hora_entrada, hora_salida, es_franco, publicado')
        .eq('empleado_id', empleado.id)
        .eq('fecha', fecha)
        .maybeSingle()

      const horaProgramada = tipo === 'entrada' ? crono?.hora_entrada ?? null : crono?.hora_salida ?? null
      const minutosDif = diffMinutosVsHorario(ahora, horaProgramada)

      // Warnings (no bloquean)
      let w: string | null = null
      if (crono?.es_franco) w = 'Hoy figurás de franco. Quedará registrado igual.'
      else if (crono && !crono.publicado) w = 'Tu horario de hoy está en borrador (sin publicar). Queda registrado igual.'
      else if (!horaProgramada) w = 'No tenés horario asignado para hoy.'
      else if (minutosDif !== null && Math.abs(minutosDif) > TOLERANCIA_MIN)
        w = `Estás ${minutosDif > 0 ? 'tarde' : 'antes'} ${Math.abs(minutosDif)} min vs tu horario.`
      setWarning(w)

      // Subir foto comprimida (path con nonce para evitar colisiones en ms idénticos)
      const comprimida = await comprimirImagen(fotoBlob)
      const nonce = Math.random().toString(36).slice(2, 8)
      const path = `${empleado.id}/${fecha}/${ahora.getTime()}_${nonce}_${tipo}.jpg`
      const { error: upErr } = await supabase.storage
        .from('fichadas-fotos')
        .upload(path, comprimida, { contentType: 'image/jpeg', upsert: false })
      if (upErr) throw upErr

      // Insertar fichada — si falla, borrar la foto que quedó huérfana
      const { error: insErr } = await supabase.from('fichadas').insert({
        empleado_id: empleado.id,
        fecha,
        tipo,
        timestamp: ahora.toISOString(),
        local: localDetectado,
        lat: coords.lat,
        lng: coords.lng,
        foto_path: path,
        minutos_diferencia: minutosDif,
        origen: 'pwa',
      })
      if (insErr) {
        await supabase.storage.from('fichadas-fotos').remove([path]).catch(() => {})
        throw insErr
      }

      setResultado({ tipo, minutos: minutosDif })
      setPaso('ok')
    } catch (e: any) {
      setMensaje('Error: ' + (e?.message || e))
      setPaso('error')
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {paso === 'gps' && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-700">{mensaje}</p>
        </div>
      )}

      {paso === 'foto' && (
        <>
          <p className="text-xs text-gray-500 mb-2">{mensaje}</p>
          {!fotoPreview ? (
            <>
              <video ref={videoRef} playsInline muted className="w-full rounded bg-black aspect-[3/4] object-cover" />
              <button
                onClick={tomarFoto}
                className="w-full bg-rodziny-700 text-white py-3 rounded font-medium text-sm mt-3"
              >
                Tomar foto
              </button>
            </>
          ) : (
            <>
              <img src={fotoPreview} alt="selfie" className="w-full rounded aspect-[3/4] object-cover" />
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  onClick={() => { setFotoBlob(null); setFotoPreview(null); setPaso('foto') }}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded text-sm"
                >
                  Reintentar
                </button>
                <button
                  onClick={confirmarFichaje}
                  className="bg-rodziny-700 hover:bg-rodziny-800 text-white py-2.5 rounded text-sm font-medium"
                >
                  Confirmar
                </button>
              </div>
            </>
          )}
          <button onClick={onCancelar} className="block w-full text-xs text-gray-500 underline mt-3">Cancelar</button>
        </>
      )}

      {paso === 'subiendo' && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-700">{mensaje}</p>
        </div>
      )}

      {paso === 'ok' && resultado && (
        <div className="text-center py-4">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-base font-semibold text-gray-900 capitalize">{resultado.tipo} registrada</p>
          <p className="text-xs text-gray-500 mt-1">{hhmm(new Date())}</p>
          {resultado.minutos !== null && (
            <p className={cn(
              'text-xs mt-2',
              Math.abs(resultado.minutos) <= TOLERANCIA_MIN ? 'text-green-700' : 'text-amber-700'
            )}>
              {resultado.minutos === 0
                ? 'Puntual'
                : resultado.minutos > 0
                  ? `+${resultado.minutos} min vs horario`
                  : `${resultado.minutos} min vs horario`}
            </p>
          )}
          {warning && <p className="text-xs text-amber-700 mt-2">{warning}</p>}
          <button
            onClick={onListo}
            className="w-full bg-rodziny-700 hover:bg-rodziny-800 text-white py-2.5 rounded font-medium text-sm mt-4"
          >
            Listo
          </button>
        </div>
      )}

      {paso === 'error' && (
        <div className="text-center py-4">
          <div className="text-3xl mb-2">⚠</div>
          <p className="text-sm text-red-700">{mensaje}</p>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button onClick={onCancelar} className="bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded text-sm">Volver</button>
            <button onClick={() => setPaso('gps')} className="bg-rodziny-700 text-white py-2.5 rounded text-sm">Reintentar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Mis horarios ───────────────────────────────────────────────────────────
function MisHorarios({ empleado, onVolver }: { empleado: Empleado; onVolver: () => void }) {
  const [filas, setFilas] = useState<Cronograma[]>([])

  useEffect(() => {
    const hoy = new Date()
    const desde = ymd(hoy)
    const hastaDt = new Date(hoy); hastaDt.setDate(hastaDt.getDate() + 14)
    const hasta = ymd(hastaDt)
    supabase
      .from('cronograma')
      .select('*')
      .eq('empleado_id', empleado.id)
      .eq('publicado', true)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
      .then(({ data }) => setFilas((data as Cronograma[]) || []))
  }, [empleado.id])

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Próximos 14 días</h3>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>
      {filas.length === 0 ? (
        <p className="text-xs text-gray-500">Sin horarios publicados.</p>
      ) : (
        <div className="space-y-1.5">
          {filas.map((f) => {
            const d = new Date(f.fecha + 'T00:00:00')
            const dia = d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' })
            return (
              <div key={f.id} className="flex justify-between text-xs border-b border-gray-100 py-1.5">
                <span className="capitalize text-gray-700">{dia}</span>
                <span className={cn('font-medium', f.es_franco ? 'text-blue-700' : 'text-gray-900')}>
                  {f.es_franco ? 'Franco' : `${f.hora_entrada} – ${f.hora_salida}`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Mi quincena ────────────────────────────────────────────────────────────
function MiQuincena({ empleado, onVolver }: { empleado: Empleado; onVolver: () => void }) {
  const [stats, setStats] = useState<{
    fichadas: number
    tardanzasMayores: number
    ausencias: number
    horasTrabajadas: number
    horasRequeridas: number
  } | null>(null)

  useEffect(() => {
    (async () => {
      const hoy = new Date()
      const dia = hoy.getDate()
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), dia <= 14 ? 1 : 15)
      const finDia = dia <= 14 ? 14 : new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate()
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), finDia)
      const desde = ymd(ini)
      const hasta = ymd(fin)

      const [{ data: fich }, { data: crono }] = await Promise.all([
        supabase.from('fichadas').select('*').eq('empleado_id', empleado.id).gte('fecha', desde).lte('fecha', hasta),
        supabase.from('cronograma').select('*').eq('empleado_id', empleado.id).gte('fecha', desde).lte('fecha', hasta),
      ])

      const fichArr = (fich as Fichada[]) || []
      const cronoArr = (crono as Cronograma[]) || []

      // Tardanzas > tolerancia en entradas
      const tardanzasMayores = fichArr.filter(
        (f) => f.tipo === 'entrada' && f.minutos_diferencia !== null && f.minutos_diferencia > TOLERANCIA_MIN
      ).length

      // Ausencias: días con cronograma no franco y publicado, sin ninguna fichada
      const ausencias = cronoArr.filter((c) => {
        if (c.es_franco || !c.publicado) return false
        if (new Date(c.fecha + 'T00:00:00') > hoy) return false
        return !fichArr.some((f) => f.fecha === c.fecha)
      }).length

      // Horas trabajadas (pares entrada/salida por día)
      let horasTrabajadas = 0
      const porDia: Record<string, Fichada[]> = {}
      fichArr.forEach((f) => { (porDia[f.fecha] ||= []).push(f) })
      Object.values(porDia).forEach((arr) => {
        arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        for (let i = 0; i + 1 < arr.length; i += 2) {
          const t1 = new Date(arr[i].timestamp).getTime()
          const t2 = new Date(arr[i + 1].timestamp).getTime()
          horasTrabajadas += Math.max(0, (t2 - t1) / 3600000)
        }
      })

      // Horas requeridas (flexibles): horas_semanales × 2
      const horasRequeridas = empleado.horario_tipo === 'flexible' && empleado.horas_semanales_requeridas
        ? empleado.horas_semanales_requeridas * 2
        : 0

      setStats({
        fichadas: fichArr.length,
        tardanzasMayores,
        ausencias,
        horasTrabajadas: Math.round(horasTrabajadas * 10) / 10,
        horasRequeridas,
      })
    })()
  }, [empleado])

  const ganaPresentismo = stats
    ? empleado.horario_tipo === 'flexible'
      ? stats.horasRequeridas > 0 && stats.horasTrabajadas >= stats.horasRequeridas && stats.ausencias === 0
      : stats.ausencias === 0 && stats.tardanzasMayores === 0
    : false

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Mi quincena</h3>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">Volver</button>
      </div>

      {!stats ? (
        <p className="text-xs text-gray-500">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Tarjeta label="Fichajes" value={String(stats.fichadas)} />
            <Tarjeta label="Ausencias" value={String(stats.ausencias)} />
            <Tarjeta label="Tardanzas" value={String(stats.tardanzasMayores)} />
            <Tarjeta
              label={empleado.horario_tipo === 'flexible' ? 'Horas' : 'Trabajadas'}
              value={
                empleado.horario_tipo === 'flexible' && stats.horasRequeridas
                  ? `${stats.horasTrabajadas} / ${stats.horasRequeridas}`
                  : `${stats.horasTrabajadas} h`
              }
            />
          </div>

          <div className={cn(
            'mt-3 rounded p-3 text-xs font-medium text-center',
            ganaPresentismo ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'
          )}>
            {ganaPresentismo ? '✓ Estás ganando el presentismo' : 'Presentismo en riesgo'}
          </div>
        </>
      )}
    </div>
  )
}

function Tarjeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded p-2.5">
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
      <p className="text-base font-semibold text-gray-900">{value}</p>
    </div>
  )
}
