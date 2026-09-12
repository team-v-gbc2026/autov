"use client";
import Image from "next/image";
import { useRef, useState } from "react";
import Icon from "./icon";
import { iconButton as button } from "./icon-button";
import type { ReferenceState } from "./use-references";

export default function ReferencesPanel({
  state,
  onCollapse,
}: {
  state: ReferenceState;
  onCollapse: () => void;
}) {
  const { references, busy, error, setError, addFiles, removeReference } =
    state;
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <aside className="glass reference-panel">
      <div className="panel-heading">
        <div>
          <Icon name="image" />
          <h2>References</h2>
          <span className="count">
            {references.length.toString().padStart(2, "0")}
          </span>
        </div>
        {button("panel", "Collapse references", onCollapse)}
      </div>
      <div className="panel-body">
        <button
          className={`drop-zone ${drag ? "dragging" : ""}`}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <span className="upload-icon">
            <Icon name="plus" size={22} />
          </span>
          <strong>Add references</strong>
          <span>Drop images or browse</span>
          <small>{busy ? "SAVING…" : "IMAGES · UP TO 20 MB · MAX 8"}</small>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="reference-list">
          {references.map((ref) => (
            <div className="reference-item" key={ref.id}>
              <Image
                unoptimized
                width={240}
                height={160}
                src={ref.url}
                alt={ref.name}
                onError={() =>
                  setError(
                    "Image link expired or unavailable. Reload this project to refresh it.",
                  )
                }
              />
              <div>
                <span>{ref.name}</span>
                {button("close", `Remove ${ref.name}`, () => {
                  void removeReference(ref.id);
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
