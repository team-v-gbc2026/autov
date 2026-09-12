"use client";
import { useState, type ReactNode } from "react";
import Icon from "./icon";
import { iconButton as button } from "./icon-button";
import type { Playback } from "./use-playback";

export default function PlaybackPanel({
  playback,
  duration = 8,
  name = "Particle study",
  children,
}: {
  playback: Playback;
  duration?: number;
  name?: string;
  children?: ReactNode;
}) {
  const { playing, setPlaying, time, setTime, loop, setLoop } = playback;
  const [controls, setControls] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  return (
    <>
      {!timelineOpen && (
        <button
          className="bottom-timeline-toggle"
          onClick={() => setTimelineOpen(true)}
          aria-label="Open timeline"
          aria-expanded={false}
          aria-controls="playback-timeline"
        >
          <span className="rotated">
            <Icon name="chevron" size={15} />
          </span>
          <span>Timeline</span>
        </button>
      )}
      {timelineOpen && (
        <section
          id="playback-timeline"
          className="glass transport"
          aria-label="Playback and effect controls"
        >
          <div className="transport-top">
            <div className="playback-buttons">
              {button("reset", "Restart playback", () => setTime(0))}
              <button
                className="play-button"
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => {
                  if (time >= duration) setTime(0);
                  setPlaying(!playing);
                }}
              >
                <Icon name={playing ? "pause" : "play"} size={16} />
              </button>
              {button(
                "loop",
                loop ? "Disable looping" : "Enable looping",
                () => setLoop(!loop),
                loop,
              )}
            </div>
            <span className="time-code">
              {time.toFixed(2).padStart(5, "0")}{" "}
              <span>/ {duration.toFixed(2).padStart(5, "0")}</span>
            </span>
            <button
              className="icon-button timeline-collapse"
              onClick={() => setTimelineOpen(false)}
              aria-label="Collapse timeline"
              title="Collapse timeline"
              aria-expanded={true}
              aria-controls="playback-timeline"
            >
              <Icon name="chevron" size={15} />
            </button>
          </div>
          <div className="timeline">
            <div className="time-ruler">
              {[0, duration / 4, duration / 2, duration * 0.75, duration].map(
                (t) => (
                  <span key={t}>{t.toFixed(2)}</span>
                ),
              )}
            </div>
            <div className="timeline-track">
              <div className="effect-clip">
                <span>{name}</span>
                <span>{duration.toFixed(1)}s</span>
              </div>
              <div
                className="playhead"
                style={{ left: `${(time / duration) * 100}%` }}
              />
              <input
                aria-label="Playback position"
                type="range"
                min="0"
                max={duration}
                step="0.01"
                value={time}
                onChange={(e) => setTime(Number(e.target.value))}
              />
            </div>
          </div>
          <button
            className="controls-toggle"
            aria-expanded={controls}
            aria-controls="effect-controls"
            onClick={() => setControls(!controls)}
          >
            <span>
              <Icon name="sliders" size={14} /> Effect controls{" "}
            </span>
            <span className={controls ? "rotated" : ""}>
              <Icon name="chevron" size={15} />
            </span>
          </button>
          {controls && (
            <div id="effect-controls" className="control-shelf">
              {children || <p>No effect controls available.</p>}
            </div>
          )}
        </section>
      )}
    </>
  );
}
