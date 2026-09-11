// El bug que cubre este test costó plata tres veces: un UPDATE que la RLS
// bloquea devuelve cero filas y ningún error.
import { describe, it, expect, vi } from 'vitest';
import { guardarContando, type EscrituraPendiente } from './escribir';

/** Una escritura de mentira que devuelve lo que se le diga. */
function escrituraQueDevuelve(data: unknown[] | null, error: unknown = null) {
  const select = vi.fn(async () => ({ data, error }));
  return { select } as unknown as EscrituraPendiente & { select: typeof select };
}

describe('guardarContando', () => {
  it('💣 cero filas y ningún error TIENE que tirar: ese es el bug', async () => {
    const e = escrituraQueDevuelve([]);
    await expect(guardarContando(e, 'No se pudo cerrar el turno')).rejects.toThrow(
      /no se guardó ninguna fila/i,
    );
  });

  it('el mensaje dice qué se estaba haciendo, no "error de base de datos"', async () => {
    const e = escrituraQueDevuelve([]);
    await expect(guardarContando(e, 'No se pudo cerrar el turno')).rejects.toThrow(
      /No se pudo cerrar el turno/,
    );
  });

  it('null también es cero filas', async () => {
    const e = escrituraQueDevuelve(null);
    await expect(guardarContando(e, 'Probando')).rejects.toThrow(/no se guardó ninguna fila/i);
  });

  it('pone el .select() solo: por eso no se puede olvidar', async () => {
    const e = escrituraQueDevuelve([{ id: 'a' }]);
    await guardarContando(e, 'Probando');
    expect(e.select).toHaveBeenCalledTimes(1);
    expect(e.select).toHaveBeenCalledWith('*');
  });

  it('devuelve cuántas filas tocó', async () => {
    const e = escrituraQueDevuelve([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    await expect(guardarContando(e, 'Probando')).resolves.toBe(3);
  });

  it('un error de la base se propaga con el contexto adelante', async () => {
    const e = escrituraQueDevuelve(null, { message: 'permission denied', code: '42501' });
    await expect(guardarContando(e, 'No se pudo borrar el arqueo')).rejects.toThrow(
      /No se pudo borrar el arqueo/,
    );
  });

  it('permitirCero deja pasar el cero, pero hay que pedirlo a mano', async () => {
    const e = escrituraQueDevuelve([]);
    await expect(guardarContando(e, 'Probando', { permitirCero: true })).resolves.toBe(0);
  });

  it('filasEsperadas tira si vuelve otro número', async () => {
    const e = escrituraQueDevuelve([{ id: 'a' }]);
    await expect(
      guardarContando(e, 'Borrando el arqueo anterior', { filasEsperadas: 3 }),
    ).rejects.toThrow(/se tocaron 1 filas y esperaba 3/);
  });

  it('filasEsperadas pasa si coincide', async () => {
    const e = escrituraQueDevuelve([{ id: 'a' }, { id: 'b' }]);
    await expect(guardarContando(e, 'Probando', { filasEsperadas: 2 })).resolves.toBe(2);
  });

  it('se le pueden pedir columnas puntuales en vez de todas', async () => {
    const e = escrituraQueDevuelve([{ id: 'a' }]);
    await guardarContando(e, 'Probando', { columnas: 'id' });
    expect(e.select).toHaveBeenCalledWith('id');
  });
});
