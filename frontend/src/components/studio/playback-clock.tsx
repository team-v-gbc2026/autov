"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from "react";
type State = { playing: boolean; time: number; loop: boolean };
type Action =
  | { type: "tick"; delta: number; duration: number }
  | { type: "time"; value: SetStateAction<number>; duration: number }
  | { type: "playing" | "loop"; value: SetStateAction<boolean> };

function reducePlayback(state: State, action: Action): State {
  if (action.type === "tick") {
    if (!state.playing) return state;
    const next = state.time + action.delta;
    return next >= action.duration
      ? {
          ...state,
          time: state.loop ? next % action.duration : action.duration,
          playing: state.loop,
        }
      : { ...state, time: next };
  }
  if (action.type === "time") {
    const value =
      typeof action.value === "function"
        ? action.value(state.time)
        : action.value;
    const time = Math.max(0, Math.min(action.duration, value));
    return {
      ...state,
      time,
      playing:
        time === action.duration && !state.loop ? false : state.playing,
    };
  }
  const value =
    typeof action.value === "function"
      ? action.value(state[action.type])
      : action.value;
  return { ...state, [action.type]: value };
}

export type Playback = State & {
  setTime(value: SetStateAction<number>): void;
  setPlaying(value: SetStateAction<boolean>): void;
  setLoop(value: SetStateAction<boolean>): void;
};

/** An external animation clock: ticking must not rerender the board/chat/Studio. */
export function createPlaybackClock(initialDuration: number) {
  let duration = initialDuration;
  let state = { playing: true, time: 0, loop: true };
  const listeners = new Set<() => void>();
  // Preparing a document blocks the main thread while the device builds its
  // pipelines. Ticking through that stall would hand playback a frozen picture
  // that jumps forward the moment the scene is ready, so the scene holds the
  // timeline instead and releases it once the renderer can draw.
  let holds = 0;
  const displayListeners = new Set<() => void>();
  let displaySnapshot: Playback;
  let displayElapsed = 0;
  let snapshot: Playback;
  const publish = (display = true) => {
    snapshot = { ...state, time: Math.min(state.time, duration), ...actions };
    for (const listener of listeners) listener();
    if (display) {
      displayElapsed = 0;
      displaySnapshot = snapshot;
      for (const listener of displayListeners) listener();
    }
  };
  const dispatch = (action: Parameters<typeof reducePlayback>[1]) => {
    const next = reducePlayback(state, action);
    if (next.time === state.time && next.playing === state.playing && next.loop === state.loop) return;
    const immediate = action.type !== "tick" || next.playing !== state.playing || next.time < state.time;
    if (action.type === "tick") displayElapsed += action.delta;
    state = next;
    publish(immediate || displayElapsed >= 1 / 30 - 1e-9);
  };
  const actions: Pick<Playback, "setTime" | "setPlaying" | "setLoop"> = {
    setTime: value => dispatch({ type: "time", value, duration }),
    setPlaying: value => dispatch({ type: "playing", value }),
    setLoop: value => dispatch({ type: "loop", value }),
  };
  publish();
  return {
    getSnapshot: () => snapshot,
    getDisplaySnapshot: () => displaySnapshot,
    subscribeDisplay: (listener: () => void) => {
      displayListeners.add(listener);
      return () => { displayListeners.delete(listener); };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setDuration(value: number) {
      if (value === duration) return;
      duration = value;
      state = { ...state, time: Math.min(state.time, duration) };
      publish();
    },
    tick(delta: number) {
      if (holds > 0) return;
      dispatch({ type: "tick", delta, duration });
    },
    /** Suspends the timeline until every holder releases it. */
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds = Math.max(0, holds - 1);
      };
    },
    held: () => holds > 0,
  };
}

export type PlaybackClock = ReturnType<typeof createPlaybackClock>;
export function usePlaybackClock(duration: number) {
  const [clock] = useState(() => createPlaybackClock(duration));
  useEffect(() => { clock.setDuration(duration); }, [clock, duration]);
  useEffect(() => {
    let frame: number;
    let previous = performance.now();
    const tick = (now: number) => {
      clock.tick(Math.min((now - previous) / 1000, 0.1));
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock]);
  return clock;
}

export function PlaybackFrames({ clock, children }: {
  clock: PlaybackClock;
  children: (playback: Playback) => ReactNode;
}) {
  const playback = useSyncExternalStore(clock.subscribeDisplay, clock.getDisplaySnapshot, clock.getDisplaySnapshot);
  return children(playback);
}

/** Subscribe a view to the bounded display clock; actions still publish immediately. */
export function usePlayback(duration = 8): Playback {
  const clock = usePlaybackClock(duration);
  return useSyncExternalStore(clock.subscribeDisplay, clock.getDisplaySnapshot, clock.getDisplaySnapshot);
}
