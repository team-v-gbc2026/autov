"use client";

import { useEffect, useRef, useState } from "react";
import type { BackdropController } from "@/lib/vfx-lab/backdrop-controller";

const SAVED_CLEAN = "autov.vfx-lab.clean-image.v1";
type Result = { error?: string; cleanId?: string; cleanImage?: string; splatUrl?: string };

export function SplatGenerationPanel({ controller, panelStyle, labelStyle, buttonStyle }: {
  controller: BackdropController | null;
  panelStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}) {
  const referenceInput = useRef<HTMLInputElement>(null);
  const cleanInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [clean, setClean] = useState<{ id: string; image: string } | null>(null);
  const [adjustment, setAdjustment] = useState("");
  const [splatUrl, setSplatUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("Upload a clean image or choose a reference to clean.");
  const [busy, setBusy] = useState<"clean" | "import" | "splat" | "load" | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      const id = localStorage.getItem(SAVED_CLEAN);
      if (id && /^[0-9a-f-]{36}$/.test(id)) {
        setClean({ id, image: `/api/local-splat?id=${id}&kind=clean` });
        setStatus("Saved clean image restored. Review it, then generate the splat.");
      }
    } catch { /* optional persistence */ }
  }, []);

  async function post(body: unknown): Promise<Result> {
    const response = await fetch("/api/local-splat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as Result;
    if (!response.ok) throw new Error(result.error || "Generation failed.");
    return result;
  }

  async function importClean(upload: File) {
    if (busy) return;
    setBusy("import"); setFailed(false); setStatus("Saving your clean image…");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(upload.type) || !upload.size || upload.size > 20 * 1024 * 1024)
        throw new Error("Choose a PNG, JPEG, or WebP image up to 20 MB.");
      const cleanImage = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the image."));
        reader.readAsDataURL(upload);
      });
      const result = await post({ stage: "import", cleanImage });
      if (!result.cleanId || !result.cleanImage) throw new Error("No clean image was returned.");
      setClean({ id: result.cleanId, image: result.cleanImage });
      setFile(null); setAdjustment(""); setSplatUrl(null);
      if (referenceInput.current) referenceInput.current.value = "";
      try { localStorage.setItem(SAVED_CLEAN, result.cleanId); } catch { /* optional persistence */ }
      setStatus("Clean image uploaded. Review it, then generate the splat when ready. No OpenAI cleanup was used.");
    } catch (error) {
      setFailed(true); setStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally { setBusy(null); }
  }

  async function generateClean() {
    if (!file || busy) return;
    setBusy("clean"); setFailed(false); setStatus("Checking reconstruction setup, then removing the effect…");
    try {
      const reference = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the image."));
        reader.readAsDataURL(file);
      });
      // Always edit the original reference, avoiding cumulative regeneration drift.
      const result = await post({ stage: "clean", reference, adjustment });
      if (!result.cleanId || !result.cleanImage) throw new Error("No clean image was returned.");
      setClean({ id: result.cleanId, image: result.cleanImage }); setSplatUrl(null);
      try { localStorage.setItem(SAVED_CLEAN, result.cleanId); } catch { /* optional persistence */ }
      setStatus("Review the clean image. Regenerate if needed, or use it to generate a splat.");
    } catch (error) {
      setFailed(true); setStatus(error instanceof Error ? error.message : "Cleanup failed.");
    } finally { setBusy(null); }
  }

  async function generateSplat() {
    if (!clean || busy) return;
    setBusy("splat"); setFailed(false); setStatus("Reconstructing the approved clean image in ComfyUI…");
    try {
      const result = await post({ stage: "splat", cleanId: clean.id });
      if (!result.splatUrl) throw new Error("No splat was returned.");
      setSplatUrl(result.splatUrl); setStatus("Splat ready to load into the backdrop.");
    } catch (error) {
      setFailed(true); setStatus(`${error instanceof Error ? error.message : "Reconstruction failed."} Your clean image is saved; retry reconstruction without regenerating it.`);
    } finally { setBusy(null); }
  }

  async function loadSplat() {
    if (!controller || !splatUrl || busy) return;
    setBusy("load"); setFailed(false);
    try { await controller.load(splatUrl); setStatus("Splat loaded into the backdrop."); }
    catch (error) { setFailed(true); setStatus(error instanceof Error ? error.message : "Could not load splat."); }
    finally { setBusy(null); }
  }

  return <div style={panelStyle} data-testid="splat-generation-panel">
    <span style={labelStyle}>Reference → Gaussian splat</span>
    <p style={{ fontSize: 11, color: "#7d848c", lineHeight: 1.45 }}>Remove the effect, or upload an already-clean image. Review it, then reconstruct it in ComfyUI.</p>
    <input ref={cleanInput} aria-label="Clean image" type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!!busy} onChange={e => {
      const upload = e.target.files?.[0];
      e.target.value = "";
      if (upload) void importClean(upload);
    }} />
    <button style={{ ...buttonStyle, width: "100%", marginBottom: 6 }} onClick={() => cleanInput.current?.click()} disabled={!!busy}>
      {busy === "import" ? "Uploading clean image…" : "Upload clean image"}
    </button>
    <p style={{ fontSize: 11, color: "#7d848c" }}>Already clean: PNG, JPEG, or WebP, up to 20 MB. Skips OpenAI cleanup.</p>
    <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Or clean an original reference</span>
    <input ref={referenceInput} aria-label="Reference image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
      if (!e.target.files?.[0]) return;
      setFile(e.target.files[0]); setClean(null); setSplatUrl(null); setAdjustment(""); setFailed(false);
      try { localStorage.removeItem(SAVED_CLEAN); } catch { /* optional persistence */ }
      setStatus(e.target.files?.[0]?.name || "Choose a reference image.");
    }} disabled={!!busy} style={{ width: "100%", fontSize: 11 }} />
    {!clean && <button style={{ ...buttonStyle, width: "100%", marginTop: 7 }} onClick={() => void generateClean()} disabled={!file || !!busy}>
      {busy === "clean" ? "Generating clean image…" : "Generate clean image"}
    </button>}
    {clean && <section data-testid="clean-image-review" aria-label="Review clean image" style={{ border: "1px solid #39404a", padding: 8, marginTop: 10, borderRadius: 4 }}>
      <span style={labelStyle}>Review clean image</span>
      {/* Local image asset: deliberately retain its full aspect ratio. */}
      <img src={clean.image} alt="Clean image for reconstruction" style={{ width: "100%", height: "auto", marginTop: 8, borderRadius: 4 }} />
      <a href={clean.image} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>Open full clean image</a>
      {file && <>
      <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>
        What should change? (optional)
        <textarea value={adjustment} onChange={e => setAdjustment(e.target.value)} maxLength={2000} disabled={!!busy || !file} placeholder="For example: keep the painted texture and remove the remaining glow." style={{ width: "100%", marginTop: 4, fontSize: 11 }} />
      </label>
      <button style={{ ...buttonStyle, width: "100%", marginTop: 6 }} onClick={() => void generateClean()} disabled={!file || !!busy}>
        {busy === "clean" ? "Regenerating…" : "Regenerate clean image"}
      </button>
      </>}
      <button style={{ ...buttonStyle, width: "100%", marginTop: 6 }} onClick={() => void generateSplat()} disabled={!!busy}>
        {busy === "splat" ? "Reconstructing…" : "Use this image → Generate splat"}
      </button>
      <p style={{ fontSize: 11, color: "#7d848c", marginBottom: 0 }}>Reconstruction retries reuse this saved image.</p>
    </section>}
    {splatUrl && <button style={{ ...buttonStyle, width: "100%", marginTop: 6 }} onClick={() => void loadSplat()} disabled={!controller || !!busy}>Load splat into backdrop</button>}
    <p role="status" style={{ fontSize: 11, color: failed ? "#e0806f" : "#7d848c", marginBottom: 0 }}>{status}</p>
  </div>;
}
