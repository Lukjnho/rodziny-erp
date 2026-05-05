import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

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

function formatear(n: number): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatearMientrasEscribe(s: string): string {
  const limpio = s.replace(/[^\d,]/g, '');
  const partes = limpio.split(',');
  const enteroSinFormat = partes[0] ?? '';
  const enteroNum = enteroSinFormat ? parseInt(enteroSinFormat, 10) : 0;
  const enteroFmt = isNaN(enteroNum)
    ? ''
    : enteroNum.toLocaleString('es-AR', { useGrouping: true });
  if (partes.length === 1) {
    return enteroSinFormat ? enteroFmt : '';
  }
  const dec = partes[1].slice(0, 2);
  return `${enteroFmt},${dec}`;
}

function parsear(s: string): number | null {
  if (!s.trim()) return null;
  const norm = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(norm);
  return isFinite(n) ? n : null;
}

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
      onBlur={() => {
        editingRef.current = false;
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
