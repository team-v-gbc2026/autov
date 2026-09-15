const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Fetch a board image and hand it to the browser as a download. Signed
 * reference URLs are cross-origin, so `<a download>` alone would navigate
 * instead of saving. */
export async function downloadReference(reference: { name: string; url: string }) {
  const response = await fetch(reference.url);
  if (!response.ok) throw new Error("Image unavailable.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  const name = reference.name || "image";
  const extension = EXTENSION_BY_MIME[blob.type.split(";")[0].trim()];
  link.download = extension && !name.toLowerCase().endsWith(`.${extension}`) ? `${name}.${extension}` : name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
