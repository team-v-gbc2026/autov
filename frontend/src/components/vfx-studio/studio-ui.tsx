"use client";

import { useState } from "react";
import Link from "next/link";
import ParticleScene from "@/components/particle-scene";
import ChatEmptyState from "@/components/studio/chat-empty-state";
import Icon from "@/components/studio/icon";
import IconButton from "@/components/studio/icon-button";
import PanelToggle from "@/components/studio/panel-toggle";
import PlaybackPanel from "@/components/studio/playback-panel";
import { usePlayback } from "@/components/studio/use-playback";
import EmitterTimeline, { type PreviewLayer } from "./emitter-timeline";
import sampleEffect from "./sample-effect.json";
import "./studio-ui.css";

const DURATION = sampleEffect.duration;
const INITIAL_LAYERS: PreviewLayer[] = sampleEffect.layers;
const PARAMETERS = sampleEffect.controls as [string, number][];

export default function VfxStudioUi() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [selectedId, setSelectedId] = useState("arc");
  const [soloId, setSoloId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const playback = usePlayback(DURATION);
  const selected = layers.find((layer) => layer.id === selectedId) || layers[0];

  const toggleLayer = (id: string) => {
    setLayers((items) =>
      items.map((layer) =>
        layer.id === id ? { ...layer, enabled: !layer.enabled } : layer,
      ),
    );
  };

  const effectControls = (
    <div className="lab-controls lab-emitter-controls">
      <h3 className="lab-section-label lab-wide">
        {selected.name} · {selected.kind} · {selected.start.toFixed(2)}–
        {selected.end.toFixed(2)} s
      </h3>
      <button
        type="button"
        className="lab-action lab-wide"
        onClick={() => {
          setEditMode(true);
          setRightOpen(true);
        }}
      >
        Edit this layer in chat ↗
      </button>
      <label className="lab-field">
        Color
        <input
          type="color"
          aria-label="Layer color"
          value={selected.color}
          onChange={(event) =>
            setLayers((items) =>
              items.map((layer) =>
                layer.id === selected.id
                  ? { ...layer, color: event.target.value }
                  : layer,
              ),
            )
          }
        />
      </label>
      <label className="lab-field">
        Secondary color
        <input
          type="color"
          aria-label="Layer secondary color"
          defaultValue="#ff4e32"
        />
      </label>
      <label className="lab-field">
        Blend
        <select aria-label="Layer blend" defaultValue="additive">
          <option value="additive">Additive</option>
          <option value="normal">Normal</option>
        </select>
      </label>
      {PARAMETERS.map(([label, value]) => (
        <label className="lab-field" key={label}>
          <span>
            {label}
            <output>{(value / 100).toFixed(2)}</output>
          </span>
          <input
            aria-label={`Layer ${label.toLowerCase()}`}
            type="range"
            min="0"
            max="100"
            defaultValue={value}
          />
        </label>
      ))}
    </div>
  );

  const environmentControls = (
    <div className="lab-shelf">
      <label className="lab-field">
        Bloom
        <input type="range" aria-label="Bloom" min="0" max="100" defaultValue="64" />
      </label>
      <label className="lab-field">
        Exposure
        <input
          type="range"
          aria-label="Exposure"
          min="0"
          max="100"
          defaultValue="48"
        />
      </label>
      <button type="button" className="lab-action">
        Reset camera
      </button>
    </div>
  );

  return (
    <main
      className={`studio lab ${leftOpen ? "left-open" : ""} ${rightOpen ? "right-open" : ""}`}
    >
      <div className="viewport-grid" />
      <ParticleScene time={playback.time} />
      <div className="scene-navigation-hint">
        DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM
      </div>
      <div className="lab-preview-caption">
        <span>LIVE PREVIEW</span>
        <strong>{selected.name}</strong>
        <small>{soloId ? "SOLO LAYER" : "ALL LAYERS"}</small>
      </div>

      <header className="studio-header">
        <div className="project-heading">
          <Link href="/" className="studio-back-brand" aria-label="Autov home">
            <span className="wordmark">
              <span className="brand-symbol">a</span>autov
              <span className="wordmark-dot">.</span>
            </span>
          </Link>
          <span className="header-divider" />
          <span className="lab-header-name">Amber rupture study</span>
          <span className="lab-badge">UI PREVIEW · GENERATION NOT CONNECTED</span>
        </div>
        <div className="header-actions">
          <select aria-label="Load preset" className="lab-mode" defaultValue="slash">
            <option value="slash">Arc impact</option>
            <option value="burst">Energy burst</option>
            <option value="embers">Ember trail</option>
          </select>
          <button type="button" className="lab-action" disabled title="UI preview only">
            Import
          </button>
          <button type="button" className="lab-action" disabled title="UI preview only">
            JSON ↓
          </button>
          <span className="header-divider" />
          <div className="lab-preview-profile">
            <button
              type="button"
              className="lab-preview-profile-trigger"
              aria-label="Your account"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((open) => !open)}
            >
              <span className="avatar" aria-hidden="true">T</span>
              <Icon name="chevron" size={12} />
            </button>
            {profileOpen && (
              <div className="lab-preview-profile-card">
                <span>Signed in as</span>
                <strong>preview@autov.app</strong>
                <small>UI preview · account actions disabled</small>
              </div>
            )}
          </div>
        </div>
      </header>

      {!leftOpen && (
        <PanelToggle side="left" label="Board" onOpen={() => setLeftOpen(true)} />
      )}
      {!rightOpen && (
        <PanelToggle side="right" label="Chat" onOpen={() => setRightOpen(true)} />
      )}

      {leftOpen && (
        <aside className="glass reference-panel lab-board-preview">
          <div className="panel-heading">
            <div>
              <Icon name="image" size={16} />
              <h2>Board</h2>
              <span className="count">0</span>
            </div>
            <IconButton
              name="panel"
              label="Collapse reference board"
              onClick={() => setLeftOpen(false)}
            />
          </div>
          <div className="panel-body">
            <p className="panel-description">
              Collect visual references before shaping the effect.
            </p>
            <button type="button" className="drop-zone" disabled>
              <span className="upload-icon">
                <Icon name="image" />
              </span>
              <strong>Drop images here</strong>
              <span>or choose files from your computer</span>
              <small>PNG · JPEG · WEBP · GIF</small>
            </button>
            <div className="reference-note">
              <span>REFERENCE BOARD</span>
              <p>
                Uploaded references will appear here once storage is connected.
              </p>
            </div>
          </div>
          <div className="panel-footer">
            <span className="status-dot" /> UI preview only
          </div>
        </aside>
      )}

      {rightOpen && (
        <aside className="glass chat-panel">
          <div className="panel-heading">
            <div>
              <h2>Chat</h2>
            </div>
            <IconButton
              name="panel"
              label="Collapse creative assistant"
              onClick={() => setRightOpen(false)}
            />
          </div>
          <div className="chat-content chat-content-empty">
            {notice ? (
              <div className="lab-progress" role="status">
                <span>{notice}</span>
                <small>Generation logic is intentionally not included.</small>
              </div>
            ) : (
              <ChatEmptyState onSelect={setPrompt} />
            )}
          </div>
          <div className="lab-chat-options">
            <div className="lab-control-row">
              <select
                className="lab-mode"
                aria-label="Chat action"
                value={editMode ? "edit" : "generate"}
                onChange={(event) => setEditMode(event.target.value === "edit")}
              >
                <option value="generate">Generate effect</option>
                <option value="edit">Edit selected layer</option>
              </select>
              {!editMode && (
                <select className="lab-mode" aria-label="Generation quality" defaultValue="quality">
                  <option value="quality">Quality · 3 directions</option>
                  <option value="fast">Quick · 1 direction</option>
                </select>
              )}
            </div>
          </div>
          <form
            className="composer lab-preview-composer"
            onSubmit={(event) => {
              event.preventDefault();
              setNotice(
                editMode
                  ? `Edit request prepared for ${selected.name}.`
                  : "Generation request prepared in the UI.",
              );
            }}
          >
            <textarea
              aria-label="Effect prompt"
              placeholder="Describe the effect you want to create…"
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="composer-toolbar">
              <span>{editMode ? selected.name : "No references selected"}</span>
              <button
                type="submit"
                className="send-button"
                disabled={!prompt.trim()}
                aria-label={editMode ? "Prepare layer edit" : "Prepare generation"}
              >
                <Icon name="arrow" />
              </button>
            </div>
          </form>
          <div className="chat-footnote">UI preview · no API calls are made</div>
        </aside>
      )}

      <PlaybackPanel
        playback={playback}
        duration={DURATION}
        name="Amber rupture"
        tracks={
          <EmitterTimeline
            layers={layers}
            duration={DURATION}
            time={playback.time}
            selected={selected.id}
            solo={soloId}
            onSelect={setSelectedId}
            onSolo={(id) => setSoloId(soloId === id ? undefined : id)}
            onToggle={toggleLayer}
          />
        }
        effectControls={effectControls}
        environmentLabel="Environment"
      >
        {environmentControls}
      </PlaybackPanel>

      <footer className="viewport-footer">
        <span className="lab-status">
          <i /> UI prototype · {layers.length} layers
        </span>
        <span className="lab-status">
          {soloId ? "Solo layer preview" : "Presentation-only controls"}
        </span>
      </footer>
    </main>
  );
}
