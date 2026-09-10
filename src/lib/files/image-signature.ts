export type SafeRasterImage = { mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; extension: "png" | "jpg" | "webp" | "gif" };

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function detectSafeRasterImage(bytes: Uint8Array): SafeRasterImage | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return { mimeType: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mimeType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return { mimeType: "image/gif", extension: "gif" };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  return null;
}

export async function validateSafeRasterImage(file: File, maxBytes: number) {
  if (file.size <= 0 || file.size > maxBytes) return null;
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return detectSafeRasterImage(header);
}
