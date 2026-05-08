// SHA256 de un Blob/File usando WebCrypto.
// Se usa para detectar duplicados exactos antes de subir comprobantes a Storage.
export async function sha256File(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
