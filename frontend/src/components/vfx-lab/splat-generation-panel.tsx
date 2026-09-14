"use client";

/* Local uploaded images use blob/data URLs and must retain their original pixels. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import styles from "./viewer-workspace.module.css";
import type { BackdropController } from "@/lib/vfx-lab/backdrop-controller";

const SAVED_CLEAN = "autov.vfx-lab.clean-image.v1";
type Result = { error?: string; cleanId?: string; cleanImage?: string; splatUrl?: string };

export function SplatGenerationPanel({ controller, buttonStyle }: {
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

  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  useEffect(() => {
    return () => { if (referencePreview) URL.revokeObjectURL(referencePreview); };
  }, [referencePreview]);

  useEffect(() => {
    try {
      const id = localStorage.getItem(SAVED_CLEAN);
      if (id && /^[0-9a-f-]{36}$/.test(id)) {
        // Restore browser storage after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
      setFile(null); setReferencePreview(null); setAdjustment(""); setSplatUrl(null);
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

  return <section className={styles.generation} data-testid="splat-generation-panel" aria-label="Image to Gaussian splat">
    <div className={styles.sectionHeading}><h2>Image → Gaussian splat</h2><span>Review and approve before reconstruction</span></div>
    <div className={styles.steps}>
      <section className={styles.step} aria-label="Choose an input image">
        <div className={styles.stepTitle}><span>1</span><h3>Choose your input</h3></div>
        <div className={styles.inputOption}>
          <h4>Original reference</h4><p>Has an effect to remove? Create a clean scene first.</p>
          <input ref={referenceInput} aria-label="Reference image" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
            if (!e.target.files?.[0]) return;
            setFile(e.target.files[0]); setReferencePreview(URL.createObjectURL(e.target.files[0])); setClean(null); setSplatUrl(null); setAdjustment(""); setFailed(false);
            try { localStorage.removeItem(SAVED_CLEAN); } catch { /* optional persistence */ }
            setStatus(e.target.files[0].name);
          }} disabled={!!busy} />
          <button type="button" style={buttonStyle} onClick={() => referenceInput.current?.click()} disabled={!!busy}>Upload reference image</button>
          {file && <p className={styles.filename}>{file.name}</p>}
          {referencePreview && <img className={styles.referencePreview} src={referencePreview} alt="Original reference with effect" />}
          {!clean && file && <button className={styles.primary} onClick={() => void generateClean()} disabled={!!busy}>{busy === "clean" ? "Generating clean image…" : "Generate clean image"}</button>}
        </div>
        <div className={styles.orDivider}>OR</div>
        <div className={styles.inputOption}>
          <h4>Already-clean image</h4><p>Ready to reconstruct? Upload directly and skip cleanup.</p>
          <input ref={cleanInput} aria-label="Clean image" type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!!busy} onChange={e => {
            const upload = e.target.files?.[0]; e.target.value = "";
            if (upload) void importClean(upload);
          }} />
          <button style={buttonStyle} onClick={() => cleanInput.current?.click()} disabled={!!busy}>{busy === "import" ? "Uploading clean image…" : "Upload clean image"}</button>
          <p className={styles.hint}>PNG, JPEG or WebP · up to 20 MB</p>
        </div>
      </section>
      <section className={styles.step} aria-label="Review clean image" data-testid={clean ? "clean-image-review" : undefined}>
        <div className={styles.stepTitle}><span>2</span><h3>Review clean image</h3></div>
        <p>Check the scene before turning it into 3D.</p>
        {clean ? <>
          <a href={clean.image} target="_blank" rel="noreferrer" className={styles.cleanPreview}><img src={clean.image} alt="Clean image for reconstruction" /></a>
          <a href={clean.image} target="_blank" rel="noreferrer">Open full clean image ↗</a>
          {file ? <>
            <label className={styles.adjustment}>What should change? (optional)
              <textarea value={adjustment} onChange={e => setAdjustment(e.target.value)} maxLength={2000} disabled={!!busy} placeholder="Keep the painted texture and remove the remaining glow." rows={3} />
            </label>
            <button style={buttonStyle} onClick={() => void generateClean()} disabled={!!busy}>{busy === "clean" ? "Regenerating…" : "Regenerate clean image"}</button>
          </> : <p className={styles.hint}>This saved image is ready for your approval. Upload an original reference to make a new cleanup.</p>}
        </> : <div className={styles.emptyPreview}><span>Clean image preview</span><p>{busy === "clean" ? "Creating your clean image…" : "Generate from a reference or upload an already-clean image to begin."}</p></div>}
      </section>
      <section className={styles.step} aria-label="Generate and load splat">
        <div className={styles.stepTitle}><span>3</span><h3>Create the splat</h3></div>
        <p>Happy with the clean image? Approve it to start reconstruction.</p>
        <div className={styles.approvalNote}><strong>{splatUrl ? "Your splat is ready" : clean ? "Ready for your approval" : "Waiting for a clean image"}</strong><p>{splatUrl ? "Load it into the scene below to inspect the result." : "Reconstruction starts only when you choose the button below."}</p></div>
        <button className={styles.primary} onClick={() => void generateSplat()} disabled={!clean || !!busy}>{busy === "splat" ? "Reconstructing…" : "Use this image → Generate splat"}</button>
        <p className={styles.hint}>Reconstruction retries reuse your saved clean image.</p>
        {splatUrl && <button className={styles.primary} onClick={() => void loadSplat()} disabled={!controller || !!busy}>{busy === "load" ? "Loading splat…" : "Load splat into backdrop"}</button>}
      </section>
    </div>
    <p role="status" className={styles.status} style={{ color: failed ? "#ffad9e" : undefined }}>{status}</p>
  </section>;
}
