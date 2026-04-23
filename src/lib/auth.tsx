import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Modulo =
  | 'dashboard'
  | 'ventas'
  | 'finanzas'
  | 'edr'
  | 'gastos'
  | 'amortizaciones'
  | 'rrhh'
  | 'compras'
  | 'usuarios'
  | 'cocina'
  | 'almacen';

export interface Perfil {
  user_id: string;
  nombre: string;
  es_admin: boolean;
  puede_ver_dashboard: boolean;
  puede_ver_ventas: boolean;
  puede_ver_finanzas: boolean;
  puede_ver_edr: boolean;
  puede_ver_gastos: boolean;
  puede_ver_amortizaciones: boolean;
  puede_ver_rrhh: boolean;
  puede_ver_compras: boolean;
  puede_ver_usuarios: boolean;
  puede_ver_cocina: boolean;
  puede_ver_almacen: boolean;
}

interface AuthContextValue {
  user: User | null;
  perfil: Perfil | null;
  cargando: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  tienePermiso: (m: Modulo) => boolean;
  refetchPerfil: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchPerfil(userId: string): Promise<Perfil | null> {
  const { data, error } = await supabase
    .from('perfiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('Error al cargar perfil:', error);
    return null;
  }
  return data as Perfil | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let montado = true;

    // Fallback de seguridad: si en 4s no llegó ningún evento de auth, sacamos
    // la pantalla de carga igual. Esto evita el "Cargando…" infinito si
    // getSession() queda colgado (bug conocido de Supabase con refresh tokens).
    const timeoutFallback = setTimeout(() => {
      if (montado) setCargando(false);
    }, 4000);

    // No usamos getSession() — onAuthStateChange dispara INITIAL_SESSION
    // automáticamente al suscribirse y es la fuente de verdad oficial.
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (!montado) return;
      const u = session?.user ?? null;
      setUser(u);
      // CRÍTICO: cualquier llamada a Supabase adentro de este callback puede
      // deadlockear el cliente gotrue. Hay que diferir con setTimeout(0).
      if (u) {
        setTimeout(async () => {
          if (!montado) return;
          const p = await fetchPerfil(u.id);
          if (montado) {
            setPerfil(p);
            setCargando(false);
          }
        }, 0);
      } else {
        setPerfil(null);
        setCargando(false);
      }
    });

    return () => {
      montado = false;
      clearTimeout(timeoutFallback);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setPerfil(null);
    // Limpiar cache para evitar que el próximo usuario vea datos de este.
    qc.clear();
  };

  const tienePermiso = (m: Modulo): boolean => {
    if (!perfil) return false;
    if (perfil.es_admin) return true;
    switch (m) {
      case 'dashboard':
        return perfil.puede_ver_dashboard;
      case 'ventas':
        return perfil.puede_ver_ventas;
      case 'finanzas':
        return perfil.puede_ver_finanzas;
      case 'edr':
        return perfil.puede_ver_edr;
      case 'gastos':
        return perfil.puede_ver_gastos;
      case 'amortizaciones':
        return perfil.puede_ver_amortizaciones;
      case 'rrhh':
        return perfil.puede_ver_rrhh;
      case 'compras':
        return perfil.puede_ver_compras;
      case 'usuarios':
        return perfil.puede_ver_usuarios;
      case 'cocina':
        return perfil.puede_ver_cocina;
      case 'almacen':
        return perfil.puede_ver_almacen;
    }
  };

  const refetchPerfil = async () => {
    if (user) setPerfil(await fetchPerfil(user.id));
  };

  return (
    <AuthContext.Provider
      value={{ user, perfil, cargando, signIn, signOut, tienePermiso, refetchPerfil }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
