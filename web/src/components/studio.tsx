"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ParticleScene from "./particle-scene";

type Reference = { id: string; name: string; url: string; type: string };
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

export default function Studio() {
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [loop, setLoop] = useState(true);
  const [controls, setControls] = useState(false);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
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
  function addFiles(files: FileList | null) {
    if (!files) return;
    const valid: Reference[] = [];
    let rejected = false;
    for (const file of Array.from(files)) {
      if ((!file.type.startsWith("image/") && !file.type.startsWith("video/")) || file.size > 20 * 1024 * 1024) { rejected = true; continue; }
      const url = URL.createObjectURL(file); urls.current.add(url);
      valid.push({ id: crypto.randomUUID(), name: file.name, url, type: file.type });
    }
    setReferences(current => [...current, ...valid]);
    setError(rejected ? "Use images or videos smaller than 20 MB." : "");
  }
  const button = (name: string, label: string, action: () => void, active = false) => <button className={`icon-button ${active ? "active" : ""}`} onClick={action} aria-label={label} title={label}><Icon name={name} /></button>;
  return <main className={`studio ${left ? "left-open" : ""} ${right ? "right-open" : ""}`}>
    <div className="viewport-grid" />
    <ParticleScene time={time} />
    <header className="studio-header">
      <div className="project-heading"><Link href="/" className="wordmark" aria-label="Autov home"><span className="brand-symbol">a</span>autov<span className="wordmark-dot">.</span></Link><span className="header-divider" /><span className="project-name">Untitled exploration <span className="draft-tag">DRAFT</span></span></div>
      <div className="header-actions"><span className="prototype-label"><i /> Concept workspace</span>{button("panel", "Toggle references", () => setLeft(!left), left)}{button("panel", "Toggle chat", () => setRight(!right), right)}<span className="avatar">Y</span></div>
    </header>
    <div className="viewport-caption"><span className="tiny-square" /> PARTICLE STUDY <span> / </span> 001</div>
    {left && <aside className="glass reference-panel">
      <div className="panel-heading"><div><Icon name="image" /><h2>References</h2><span className="count">{references.length.toString().padStart(2, "0")}</span></div>{button("close", "Close references", () => setLeft(false))}</div>
      <div className="panel-body"><p className="panel-description">Give your imagination a starting point.</p>
        <button className={`drop-zone ${drag ? "dragging" : ""}`} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}><span className="upload-icon"><Icon name="plus" size={22} /></span><strong>Drop your references here</strong><span>or click to browse files</span><small>IMAGES & VIDEO · UP TO 20 MB</small></button>
        <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
        {error && <p role="alert" className="error-text">{error}</p>}
        <div className="reference-list">{references.map(ref => <div className="reference-item" key={ref.id}>{ref.type.startsWith("video/") ? <video src={ref.url} muted controls preload="metadata" /> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={ref.url} alt={ref.name} />}<div><span>{ref.name}</span>{button("close", `Remove ${ref.name}`, () => { URL.revokeObjectURL(ref.url); urls.current.delete(ref.url); setReferences(items => items.filter(item => item.id !== ref.id)); })}</div></div>)}</div>
        {!references.length && <div className="reference-note"><span>01 / COLLECT</span><p>A texture. A movement. A feeling.<br />It all starts with a little inspiration.</p></div>}
      </div><div className="panel-footer"><span className="status-dot" /> References stay in this session</div>
    </aside>}
    {right && <aside className="glass chat-panel"><div className="panel-heading"><div><span className="assistant-star">✳</span><h2>Creative assistant</h2></div><span className="mini-label">PREVIEW</span></div>
      <div className="chat-content"><div className="chat-intro"><div className="assistant-emblem">✳</div><span className="eyebrow">FROM A THOUGHT TO AN EFFECT</span><h2>What do you<br />want to create?</h2><p>Describe a little magic.<br />We&apos;ll make room for the extraordinary.</p></div>
      <div className="suggestions">{["A slow, swirling cloud of silver dust", "An expanding shockwave of light", "Embers drifting into the darkness"].map(text => <button key={text} onClick={() => setPrompt(text)}>{text}<span>↗</span></button>)}</div>
      <div className="messages" aria-live="polite">{messages.map((message, index) => <div key={index}><p className="user-message">{message}</p><p className="assistant-message">Prompt captured for this session. AI generation is not connected yet; the preview is a sample particle study.</p></div>)}</div></div>
      <form className="composer" onSubmit={e => { e.preventDefault(); if (prompt.trim()) { setMessages(items => [...items, prompt.trim()]); setPrompt(""); } }}><textarea aria-label="Describe your effect" placeholder="Describe your effect..." value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} /><div className="composer-toolbar"><span>Let your imagination lead.</span><button type="submit" className="send-button" disabled={!prompt.trim()} aria-label="Send prompt"><Icon name="arrow" /></button></div></form><div className="chat-footnote">A space for ideas. Generation coming next.</div>
    </aside>}
    <div className="scene-label"><span className="scene-cross">+</span><span>Silver / particle field<small>CONCEPT PREVIEW</small></span></div>
    <section className="glass transport" aria-label="Playback and effect controls"><div className="transport-top"><div className="playback-buttons">{button("reset", "Restart playback", () => setTime(0))}<button className="play-button" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (time >= 8) setTime(0); setPlaying(!playing); }}><Icon name={playing ? "pause" : "play"} size={16} /></button>{button("loop", loop ? "Disable looping" : "Enable looping", () => setLoop(!loop), loop)}</div><span className="time-code">{time.toFixed(2).padStart(5, "0")} <span>/ 08.00</span></span><span className="timeline-label">TIMELINE</span></div><div className="timeline"><div className="time-ruler">{[0, 2, 4, 6, 8].map(t => <span key={t}>{t.toFixed(2)}</span>)}</div><div className="timeline-track"><div className="effect-clip"><span>Particle study</span><span>8.0s</span></div><div className="playhead" style={{ left: `${time / 8 * 100}%` }} /><input aria-label="Playback position" type="range" min="0" max="8" step="0.01" value={time} onChange={e => setTime(Number(e.target.value))} /></div></div><button className="controls-toggle" aria-expanded={controls} aria-controls="effect-controls" onClick={() => setControls(!controls)}><span><Icon name="sliders" size={14} /> Effect controls <span className="mini-label">COMING NEXT</span></span><span className={controls ? "rotated" : ""}><Icon name="chevron" size={15} /></span></button>{controls && <div id="effect-controls" className="control-shelf"><span>YOUR EFFECT, FINELY TUNED.</span><p>A home for parameters, motion, and the details that make it yours.</p><div className="parameter-placeholders"><span>Appearance</span><span>Motion</span><span>Behavior</span></div></div>}</section>
    <footer className="viewport-footer"><span><i /> PREVIEW STAGE</span><span>AUTOV / CREATIVE ENVIRONMENT</span><span>V.001</span></footer>
  </main>;
}
