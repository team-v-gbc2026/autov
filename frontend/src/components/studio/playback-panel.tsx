"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "./icon";
import { iconButton as button } from "./icon-button";
import type { Playback } from "./playback-clock";

export default function PlaybackPanel({
  playback,
  duration = 8,
  minDuration,
  onDurationChange,
  tracks,
}: {
  playback: Playback;
  duration?: number;
  minDuration: number;
  onDurationChange: (duration: number) => void;
  tracks?: ReactNode;
}) {
  const { playing, setPlaying, time, setTime, loop, setLoop } = playback;
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [durationError, setDurationError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const hasTracks = Boolean(tracks);

  useEffect(() => {
    const node = panel.current;
    const studio = node?.closest<HTMLElement>(".lab");
    if (!node || !studio || !hasTracks) return;
    const measure = () =>
      studio.style.setProperty(
        "--timeline-height",
        `${node.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => {
      observer.disconnect();
      studio.style.setProperty("--timeline-height", "0px");
    };
  }, [timelineOpen, hasTracks]);

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
          ref={panel}
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
              {time.toFixed(2).padStart(5, "0")} {" "}
              <span>/</span>
              <input
                key={duration}
                className="lab-duration-input"
                aria-label="Total effect duration in seconds"
                title={`Total duration · minimum ${minDuration.toFixed(2)} s to include all emitters and edits`}
                type="number"
                required
                aria-describedby={durationError ? "duration-error" : undefined}
                min={minDuration}
                max={60}
                step="any"
                defaultValue={duration.toFixed(2)}
                onBlur={event => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() && Number.isFinite(value) && value >= minDuration && value <= 60) {
                    setDurationError("");
                    onDurationChange(value);
                  } else {
                    event.target.value = duration.toFixed(2);
                    setDurationError(`Use ${minDuration.toFixed(2)}–60 seconds. Shorten emitter bars or edits first to use a shorter duration.`);
                  }
                }}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    if (event.currentTarget.reportValidity()) event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.currentTarget.value = duration.toFixed(2);
                    event.currentTarget.blur();
                  }
                }}
              />
              <span>s</span>
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
          {durationError && <p id="duration-error" className="lab-duration-error" role="status">{durationError}</p>}
          <div className="timeline">{tracks}</div>
        </section>
      )}
    </>
  );
}
