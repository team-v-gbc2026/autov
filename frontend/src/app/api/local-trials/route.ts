import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isLocalRequest } from "@/lib/vfx-lab/server";
import { listTrials, saveTrial, trialDirectory } from "@/lib/vfx-lab/trials";
export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!isLocalRequest(request))
    return Response.json({ error: "Local access only" }, { status: 403 });
  try {
    const url = new URL(request.url),
      id = url.searchParams.get("id"),
      file = url.searchParams.get("file");
    if (!id)
      return Response.json(await listTrials(), {
        headers: { "Cache-Control": "no-store" },
      });
    const dir = trialDirectory(id);
    const names: Record<string, [string, string]> = {
      document: ["document.json", "application/json"],
      sheet: ["sheet.jpg", "image/jpeg"],
      video: ["video.webm", "video/webm"],
      player: ["player.html", "text/html"],
      "reference-video": ["reference.mp4", "video/mp4"],
    };
    if (file && /^reference-[0-7]$/.test(file))
      names[file] = [file, "application/octet-stream"];
    const entry = file && names[file];
    if (!entry)
      return Response.json({ error: "Unknown file" }, { status: 400 });
    // Local user data must never be traced into a deployment bundle.
    const filename = path.join(/* turbopackIgnore: true */ dir, entry[0]);
    if ((await stat(/* turbopackIgnore: true */ filename)).size > 50_000_000)
      throw Error("File too large");
    const bytes = await readFile(/* turbopackIgnore: true */ filename),
      headers: Record<string, string> = {
        "Content-Type": entry[1],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
    if (file?.startsWith("reference-")) {
      headers["Content-Type"] =
        bytes[0] === 137
          ? "image/png"
          : bytes[0] === 255
            ? "image/jpeg"
            : "image/webp";
    }
    if (file === "player")
      headers["Content-Security-Policy"] =
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'";
    return new Response(bytes, { headers });
  } catch {
    return Response.json({ error: "Trial file unavailable" }, { status: 404 });
  }
}
export async function POST(request: Request) {
  if (!isLocalRequest(request))
    return Response.json(
      { error: "Local same-origin access only" },
      { status: 403 },
    );
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw Error("JSON required");
    const reader = request.body?.getReader();
    if (!reader) throw Error("Empty body");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 26_000_000) {
        await reader.cancel();
        throw Error("Trial too large");
      }
      chunks.push(value);
    }
    const summary = await saveTrial(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not save trial" }, { status: 400 });
  }
}
