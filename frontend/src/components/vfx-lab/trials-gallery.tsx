"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { TrialSummary } from "@/lib/vfx-lab/trials";
import { score } from "@/lib/vfx-lab/protocol";
import "./trials-gallery.css";
const asset = (id: string, file: string) =>
  `/dev/vfx-lab/trials/data?id=${encodeURIComponent(id)}&file=${file}`;
export default function TrialsGallery() {
  const [trials, setTrials] = useState<TrialSummary[]>([]),
    [error, setError] = useState(""),
    [selectedSnapshot, setSelected] = useState<TrialSummary | null>(null),
    [filter, setFilter] = useState(""),
    [caseFilter, setCaseFilter] = useState(""),
    [view, setView] = useState("all");
  const selected =
    trials.find((t) => t.id === selectedSnapshot?.id) || selectedSnapshot;
  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetch("/dev/vfx-lab/trials/data")
        .then(async (r) => {
          if (!r.ok)
            throw Error("This gallery is available on the local machine only.");
          const data = await r.json();
          if (active) setTrials(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const caseIds = [
    ...new Set(
      trials.map((t) => t.caseId).filter((id): id is string => Boolean(id)),
    ),
  ].sort();
  const latest = new Map<string, TrialSummary>();
  for (const trial of trials) {
    const key = trial.caseId || trial.id,
      previous = latest.get(key);
    if (!previous || (!previous.selected && trial.selected))
      latest.set(key, trial);
  }
  const visible = (view === "latest" ? [...latest.values()] : trials).filter(
    (t) =>
      (!caseFilter || t.caseId === caseFilter) &&
      (t.caseId + " " + t.name + " " + t.prompt)
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  return (
    <main className="trials-gallery">
      <header>
        <div>
          <Link href="/workspace">← VFX Studio</Link>
          <h1>Generation trials</h1>
          <p>
            Every direction stays here. Compare the references, watch the
            result, and reopen an editable effect.
          </p>
        </div>
        <span>
          {trials.length} saved · {caseIds.length} cases · on this device
        </span>
      </header>
      <input
        className="trial-search"
        aria-label="Search trials"
        placeholder="Search case, effect or prompt…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="trial-filters">
        <label>
          Show{" "}
          <select
            aria-label="Trial view"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="all">All trials</option>
            <option value="latest">Latest selected per case</option>
          </select>
        </label>
        <label>
          Case{" "}
          <select
            aria-label="Filter case"
            value={caseFilter}
            onChange={(e) => setCaseFilter(e.target.value)}
          >
            <option value="">All cases</option>
            {caseIds.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <span>{visible.length} shown</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {!trials.length && !error && (
        <p>
          Trials will appear here after generation. This page refreshes
          automatically.
        </p>
      )}
      <div className="trial-grid">
        {visible.map((t) => (
          <article key={t.id}>
            <button className="trial-cover" onClick={() => setSelected(t)}>
              <Image
                src={asset(t.id, "sheet")}
                width={1280}
                height={606}
                unoptimized
                alt={`${t.name}, timeline of rendered frames`}
              />
            </button>
            <div className="trial-card-body">
              <small>
                {t.caseId || "Studio trial"} ·{" "}
                {t.source === "openai-live" ? "API generated" : "Authored demo"}
                {t.origin === "refined" ? " · refined" : ""}
              </small>
              <h2>{t.name}</h2>
              <p>
                {t.duration.toFixed(1)} s · {t.layers} layers
                {t.selected ? " · selected direction" : ""}
              </p>
              {t.review?.sufficientEvidence && (
                <p>
                  AI review {score(t.review).toFixed(2)}/5 · human review
                  pending
                </p>
              )}
              <button onClick={() => setSelected(t)}>Review trial ↗</button>
              <a href={asset(t.id, "document")} download={`${t.name}.json`}>
                JSON ↓
              </a>
            </div>
          </article>
        ))}
      </div>
      {selected && (
        <div
          className="trial-modal"
          role="dialog"
          aria-modal="true"
          aria-label={selected.name}
        >
          <section>
            <header>
              <div>
                <small>{selected.caseId || "Studio trial"}</small>
                <h2>{selected.name}</h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close trial"
              >
                Close ×
              </button>
            </header>
            {selected.caseId && (
              <label className="trial-version">
                Compare versions{" "}
                <select
                  aria-label="Trial version"
                  value={selected.id}
                  onChange={(e) =>
                    setSelected(
                      trials.find((t) => t.id === e.target.value) || null,
                    )
                  }
                >
                  {trials
                    .filter((t) => t.caseId === selected.caseId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.origin}
                        {t.selected ? " · selected" : ""} ·{" "}
                        {new Date(t.created).toLocaleTimeString()}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {selected.renderCorrection && (
              <p className="trial-video-caption">{selected.renderCorrection}</p>
            )}
            <div className={selected.referenceVideo ? "trial-comparison" : ""}>
              <div>
                {selected.referenceVideo && (
                  <p className="trial-video-caption">
                    Generated effect · editable real-time player
                  </p>
                )}
                {selected.player ? (
                  <iframe
                    title="Interactive VFX player"
                    src={asset(selected.id, "player")}
                    sandbox="allow-scripts"
                  />
                ) : selected.video ? (
                  <video src={asset(selected.id, "video")} controls loop />
                ) : (
                  <Image
                    src={asset(selected.id, "sheet")}
                    width={1280}
                    height={606}
                    unoptimized
                    alt="Rendered frames"
                  />
                )}
              </div>
              {selected.referenceVideo && (
                <div>
                  <p className="trial-video-caption">
                    Reference video · source timing may differ
                  </p>
                  <video
                    aria-label="Reference video"
                    src={asset(selected.id, "reference-video")}
                    controls
                    loop
                    preload="metadata"
                  />
                </div>
              )}
            </div>
            <div className="trial-detail">
              <div>
                <h3>Prompt</h3>
                <p className="trial-prompt">{selected.prompt}</p>
                <h3>References</h3>
                <div className="trial-references">
                  {Array.from({ length: selected.references }, (_, i) => (
                    <Image
                      key={i}
                      src={asset(selected.id, `reference-${i}`)}
                      width={320}
                      height={180}
                      unoptimized
                      alt={`Input reference ${i + 1}`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h3>Review</h3>
                <p>
                  {selected.review?.verdict ||
                    "Visual review pending. Successful rendering alone does not establish reference fidelity."}
                </p>
                {selected.review && (
                  <>
                    <p>
                      AI review · semantic {selected.review.semantic} / motion{" "}
                      {selected.review.motion} / hierarchy{" "}
                      {selected.review.hierarchy} / finish{" "}
                      {selected.review.finish}
                    </p>
                    <details>
                      <summary>Observed criteria</summary>
                      {selected.review.observations.map((item, i) => (
                        <p key={i}>
                          <strong>{item.result}</strong> · {item.criterion}
                          <br />
                          {item.evidence}
                        </p>
                      ))}
                    </details>
                  </>
                )}
                <p>
                  {selected.source === "openai-live"
                    ? "Generated by the application using OpenAI."
                    : "Authored renderer demonstration."}
                </p>
                <p>{selected.created}</p>
                <a href={asset(selected.id, "document")} download>
                  Download editable JSON
                </a>
                {selected.video && (
                  <p>
                    <a href={asset(selected.id, "video")} download>
                      Download video
                    </a>
                  </p>
                )}
                <p>
                  <Link
                    href={`/local?trial=${encodeURIComponent(selected.id)}`}
                  >
                    Open in studio ↗
                  </Link>
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
