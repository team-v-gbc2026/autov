import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const filePath = path.join(
    process.cwd(),
    "dev-assets",
    "vfx-v2",
    "spike-ice.html"
  );

  let html: string;
  try {
    html = fs.readFileSync(filePath, "utf8");
  } catch {
    return new Response("spike-ice.html not built yet", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}
