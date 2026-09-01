// Código auto de cocina_productos: slug de la 1ª palabra del nombre (sin
// tildes/ñ, alfanum, 4 chars) + sufijo numérico si choca con uno existente.
// `codigo` es NOT NULL + UNIQUE. Solo se usa al CREAR; al editar no se toca.
//
// Vive acá (y no en el ABM) porque hay dos altas que tienen que generar el
// código con la MISMA regla: el ABM completo (ProductoFormPanel) y el
// "Ponerla en Stock" desde la receta (RecetaEditorInline).
export function generarCodigo(nombre: string, existentes: Set<string>): string {
  const base =
    nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ñ/g, 'n')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)[0]
      ?.slice(0, 4) || 'prod';
  if (!existentes.has(base)) return base;
  let i = 2;
  while (existentes.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}
