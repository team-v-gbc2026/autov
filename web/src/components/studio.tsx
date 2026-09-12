"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import ParticleScene from "./particle-scene";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { renameProject, savePrompt } from "@/app/workspace/actions";
import { signOut } from "@/app/auth/actions";
import type { Project, Reference, Generation, EffectVersion } from "@/lib/project-types";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m7 14 5-5 5 5M12 9v11" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
    play: <path d="m9 5 11 7-11 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
    loop: <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    sliders: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.plus}</svg>;
}

export default function Studio({ project, userId, email, initialReferences, initialGenerations, versions }: {
  project: Project; userId: string; email: string; initialReferences: Reference[]; initialGenerations: Generation[]; versions: EffectVersion[];
}) {
  const router = useRouter();
  const [projectName, setProjectName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const uploading = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [loop, setLoop] = useState(true);
  const [controls, setControls] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Generation[]>(initialGenerations);
  const [references, setReferences] = useState<Reference[]>(initialReferences);
  const [loaded, setLoaded] = useState({ references: initialReferences, generations: initialGenerations });
  // Refresh server-owned data without remounting the editor or discarding an unsent prompt.
  if (loaded.references !== initialReferences || loaded.generations !== initialGenerations) {
    setLoaded({ references: initialReferences, generations: initialGenerations });
    setReferences(initialReferences);
    setMessages(initialGenerations);
  }
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, .1); previous = now;
      setTime(value => {
        const next = value + delta;
        return next >= 8 ? loop ? next % 8 : 8 : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loop]);
  useEffect(() => { if (time >= 8 && !loop) setPlaying(false); }, [time, loop]);
  async function addFiles(files: FileList | null) {
    if (!files || uploading.current) return;
    uploading.current = true; setBusy(true); setError("");
    const supabase = createClient();
    let count = references.length;
    try {
      for (const file of Array.from(files)) {
        if (count >= 8) throw new Error("Use at most 8 reference images.");
        if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error("Use PNG, JPEG, WebP, or GIF images up to 20 MB.");
        const id = crypto.randomUUID();
        const path = `${userId}/${project.id}/${id}`;
        const { error: uploadError } = await supabase.storage.from("references").upload(path, file, { contentType: file.type });
        if (uploadError) throw new Error("Image upload failed. Please try again.");
        const { error: assetError } = await supabase.from("assets").insert({ id, project_id: project.id, name: file.name.slice(0, 255), storage_path: path, mime_type: file.type, size_bytes: file.size });
        if (assetError) {
          await supabase.storage.from("references").remove([path]);
          throw new Error("Could not save the image. Please try again.");
        }
        const { data, error: urlError } = await supabase.storage.from("references").createSignedUrl(path, 3600);
        if (urlError || !data) { router.refresh(); throw new Error("Image saved. Reload to view it."); }
        setReferences(current => [...current, { id, name: file.name, url: data.signedUrl, type: file.type }]);
        count++;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not upload references."); }
    finally { uploading.current = false; setBusy(false); }
  }
  async function removeReference(id: string) {
    if (uploading.current) return;
    uploading.current = true; setBusy(true); setError("");
    try {
      const { error, data } = await createClient().from("assets").update({ archived: true }).eq("id", id).eq("project_id", project.id).select("id").single();
      if (error || !data) throw new Error("Could not remove the reference. Please retry.");
      setReferences(items => items.filter(item => item.id !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove reference."); }
    finally { uploading.current = false; setBusy(false); }
  }
  const button = (name: string, label: string, action: () => void, active = false) => <button className={`icon-button ${active ? "active" : ""}`} onClick={action} aria-label={label} title={label}><Icon name={name} /></button>;
  return <main className={`studio ${left ? "left-open" : ""} ${right ? "right-open" : ""}`}>
    <div className="viewport-grid" />
    <ParticleScene time={time} />
    <header className="studio-header">
      <div className="project-heading"><Link href="/" className="wordmark" aria-label="Autov home"><span className="brand-symbol">a</span>autov<span className="wordmark-dot">.</span></Link><span className="header-divider" /><form onSubmit={async event => { event.preventDefault(); setNotice(""); const result = await renameProject(project.id, projectName); setNotice(result.error || "Project renamed."); }} className="project-rename"><input aria-label="Project name" value={projectName} onChange={event => setProjectName(event.target.value)} required maxLength={120} /><button type="submit">Save name</button></form></div>
      <div className="header-actions"><button onClick={() => router.refresh()} disabled={saving || busy}>Refresh</button><Link href="/workspace">Projects</Link><span className="avatar" title={email}>{email.charAt(0).toUpperCase()}</span><form action={signOut}><button type="submit">Sign out</button></form></div>
    </header>
    {!left && <button className="edge-panel-toggle edge-panel-left" onClick={() => setLeft(true)} aria-label="Open references" title="Open references"><Icon name="panel" /><span>References</span></button>}
    {!right && <button className="edge-panel-toggle edge-panel-right" onClick={() => setRight(true)} aria-label="Open creative assistant" title="Open creative assistant"><Icon name="panel" /><span>Assistant</span></button>}
    {left && <aside className="glass reference-panel">
      <div className="panel-heading"><div><Icon name="image" /><h2>References</h2><span className="count">{references.length.toString().padStart(2, "0")}</span></div>{button("panel", "Collapse references", () => setLeft(false))}</div>
      <div className="panel-body"><p className="panel-description">Give your imagination a starting point.</p>
        <button className={`drop-zone ${drag ? "dragging" : ""}`} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}><span className="upload-icon"><Icon name="plus" size={22} /></span><strong>Drop your references here</strong><span>or click to browse files</span><small>{busy ? "SAVING…" : "IMAGES · UP TO 20 MB · MAX 8"}</small></button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
        {error && <p role="alert" className="error-text">{error}</p>}
        <div className="reference-list">{references.map(ref => <div className="reference-item" key={ref.id}><Image unoptimized width={240} height={160} src={ref.url} alt={ref.name} onError={() => setError("Image link expired or unavailable. Reload this project to refresh it.")} /><div><span>{ref.name}</span>{button("close", `Remove ${ref.name}`, () => { void removeReference(ref.id); })}</div></div>)}</div>
        {!references.length && <div className="reference-note"><span>01 / COLLECT</span><p>A texture. A movement. A feeling.<br />It all starts with a little inspiration.</p></div>}
      </div><div className="panel-footer"><span className="status-dot" /> {busy ? "Saving references…" : "References saved to your project"}</div>
    </aside>}
    {right && <aside className="glass chat-panel"><div className="panel-heading"><div><span className="assistant-star">✳</span><h2>Creative assistant</h2></div><div><span className="mini-label">PREVIEW</span>{button("panel", "Collapse creative assistant", () => setRight(false))}</div></div>
      <div className="chat-content"><div className="chat-intro"><div className="assistant-emblem">✳</div><span className="eyebrow">FROM A THOUGHT TO AN EFFECT</span><h2>What do you<br />want to create?</h2><p>Describe a little magic.<br />We&apos;ll make room for the extraordinary.</p></div>
      <div className="suggestions">{["A slow, swirling cloud of silver dust", "An expanding shockwave of light", "Embers drifting into the darkness"].map(text => <button key={text} onClick={() => setPrompt(text)}>{text}<span>↗</span></button>)}</div>
      <div className="messages" aria-live="polite">{messages.map(message => <div key={message.id}><p className="user-message">{message.prompt}</p><p className="assistant-message">{message.status === "draft" ? "Prompt saved. Generation is not connected yet; the preview is a sample study." : message.status === "failed" ? "Generation failed. Your prompt is saved." : `Generation ${message.status}.`}</p></div>)}
      {versions.map(version => <a className="effect-download" key={version.id} href={`/api/effects/${version.id}`}>Download effect JSON · {version.schema_version} ↓</a>)}
      {notice && <p className="account-notice" role="status">{notice}</p>}</div></div>
      <form className="composer" onSubmit={async event => {
        event.preventDefault(); if (!prompt.trim() || saving || busy) return;
        setSaving(true); setNotice("");
        try {
          const result = await savePrompt(project.id, prompt, references.map(ref => ref.id));
          if (result.error) setNotice(result.error);
          else if (result.generation) { setMessages(items => [...items, result.generation]); setPrompt(""); }
        } catch { setNotice("Could not save your prompt. Please try again."); }
        finally { setSaving(false); }
      }}><textarea aria-label="Describe your effect" placeholder="Describe your effect..." value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} maxLength={10000} disabled={saving} /><div className="composer-toolbar"><span>Let your imagination lead.</span><button type="submit" className="send-button" disabled={!prompt.trim() || saving || busy} aria-label={saving ? "Saving prompt" : "Save prompt"}><Icon name="arrow" /></button></div></form><div className="chat-footnote">Prompts are saved. Preview shows a sample effect.</div>
    </aside>}
    {!timelineOpen && <button className="bottom-timeline-toggle" onClick={() => setTimelineOpen(true)} aria-label="Open timeline" aria-expanded={false} aria-controls="playback-timeline"><span className="rotated"><Icon name="chevron" size={15} /></span><span>Timeline</span></button>}
    {timelineOpen && <section id="playback-timeline" className="glass transport" aria-label="Playback and effect controls"><div className="transport-top"><div className="playback-buttons">{button("reset", "Restart playback", () => setTime(0))}<button className="play-button" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (time >= 8) setTime(0); setPlaying(!playing); }}><Icon name={playing ? "pause" : "play"} size={16} /></button>{button("loop", loop ? "Disable looping" : "Enable looping", () => setLoop(!loop), loop)}</div><span className="time-code">{time.toFixed(2).padStart(5, "0")} <span>/ 08.00</span></span><span className="timeline-label">TIMELINE</span><button className="icon-button timeline-collapse" onClick={() => setTimelineOpen(false)} aria-label="Collapse timeline" title="Collapse timeline" aria-expanded={true} aria-controls="playback-timeline"><Icon name="chevron" size={15} /></button></div><div className="timeline"><div className="time-ruler">{[0, 2, 4, 6, 8].map(t => <span key={t}>{t.toFixed(2)}</span>)}</div><div className="timeline-track"><div className="effect-clip"><span>Particle study</span><span>8.0s</span></div><div className="playhead" style={{ left: `${time / 8 * 100}%` }} /><input aria-label="Playback position" type="range" min="0" max="8" step="0.01" value={time} onChange={e => setTime(Number(e.target.value))} /></div></div><button className="controls-toggle" aria-expanded={controls} aria-controls="effect-controls" onClick={() => setControls(!controls)}><span><Icon name="sliders" size={14} /> Effect controls <span className="mini-label">COMING NEXT</span></span><span className={controls ? "rotated" : ""}><Icon name="chevron" size={15} /></span></button>{controls && <div id="effect-controls" className="control-shelf"><span>YOUR EFFECT, FINELY TUNED.</span><p>A home for parameters, motion, and the details that make it yours.</p><div className="parameter-placeholders"><span>Appearance</span><span>Motion</span><span>Behavior</span></div></div>}</section>}
  </main>;
}
