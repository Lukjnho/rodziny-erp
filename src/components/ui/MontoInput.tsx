import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { montoADisplay, montoDesdeTipeo, montoMientrasEscribe } from '@/lib/monto';

interface MontoInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  onCommit?: (value: number | null) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

// Las tres funciones que este componente usaba en privado viven ahora en
// `lib/monto.ts`, para que las pantallas que todavía manejan el monto como
// texto puedan usar el MISMO camino en vez de escribirse el suyo.
const formatear = montoADisplay;
const formatearMientrasEscribe = montoMientrasEscribe;
const parsear = montoDesdeTipeo;

export function MontoInput({
  value,
  onChange,
  onCommit,
  disabled,
  readOnly,
  placeholder = '0',
  className,
  autoFocus,
}: MontoInputProps) {
  const [display, setDisplay] = useState<string>(value != null ? formatear(value) : '');
  const editingRef = useRef(false);
  // Se levanta cuando la persona aprieta Escape: le avisa al onBlur que este
  // no es un cierre normal y que NO tiene que confirmar lo que se tecleó.
  const cancelandoRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDisplay(value != null ? formatear(value) : '');
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoFocus={autoFocus}
      className={cn(className)}
      value={display}
      onFocus={(e) => {
        editingRef.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        const fmt = formatearMientrasEscribe(e.target.value);
        setDisplay(fmt);
        onChange(parsear(fmt));
      }}
      onKeyDown={(e) => {
        // Enter confirma (sale del campo, que es lo que dispara el guardado).
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
          return;
        }
        // Escape se arrepiente: vuelve al valor que había y no guarda nada.
        if (e.key === 'Escape') {
          cancelandoRef.current = true;
          onChange(value);
          setDisplay(value != null ? formatear(value) : '');
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={() => {
        editingRef.current = false;
        if (cancelandoRef.current) {
          cancelandoRef.current = false;
          setDisplay(value != null ? formatear(value) : '');
          return;
        }
        const parsed = parsear(display);
        setDisplay(parsed != null ? formatear(parsed) : '');
        onCommit?.(parsed);
      }}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
    />
  );
}
