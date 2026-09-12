"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { SetStateAction } from "react";

type State = { playing: boolean; time: number; loop: boolean };
type Action =
  | { type: "tick"; delta: number }
  | { type: "time"; value: SetStateAction<number> }
  | { type: "playing" | "loop"; value: SetStateAction<boolean> };
const DURATION = 8;

function reduce(state: State, action: Action): State {
  if (action.type === "tick") {
    if (!state.playing) return state;
    const next = state.time + action.delta;
    return next >= DURATION
      ? { ...state, time: state.loop ? next % DURATION : DURATION, playing: state.loop }
      : { ...state, time: next };
  }
  if (action.type === "time") {
    const value = typeof action.value === "function" ? action.value(state.time) : action.value;
    const time = Math.max(0, Math.min(DURATION, value));
    return { ...state, time, playing: time === DURATION && !state.loop ? false : state.playing };
  }
  const value = typeof action.value === "function" ? action.value(state[action.type]) : action.value;
  return { ...state, [action.type]: value };
}

export function usePlayback() {
  const [state, dispatch] = useReducer(reduce, { playing: true, time: 0, loop: true });
  const setTime = useCallback((value: SetStateAction<number>) => dispatch({ type: "time", value }), []);
  const setPlaying = useCallback((value: SetStateAction<boolean>) => dispatch({ type: "playing", value }), []);
  const setLoop = useCallback((value: SetStateAction<boolean>) => dispatch({ type: "loop", value }), []);

  useEffect(() => {
    if (!state.playing) return;
    let frame: number;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, .1);
      previous = now;
      dispatch({ type: "tick", delta });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing]);

  return { ...state, setTime, setPlaying, setLoop };
}
export type Playback = ReturnType<typeof usePlayback>;
