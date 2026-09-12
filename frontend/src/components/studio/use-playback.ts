"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { SetStateAction } from "react";

type State = { playing: boolean; time: number; loop: boolean };
type Action =
  | { type: "tick"; delta: number; duration: number }
  | { type: "time"; value: SetStateAction<number>; duration: number }
  | { type: "playing" | "loop"; value: SetStateAction<boolean> };

function reduce(state: State, action: Action): State {
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
      playing: time === action.duration && !state.loop ? false : state.playing,
    };
  }
  const value =
    typeof action.value === "function"
      ? action.value(state[action.type])
      : action.value;
  return { ...state, [action.type]: value };
}

export function usePlayback(duration = 8) {
  const [state, dispatch] = useReducer(reduce, {
    playing: true,
    time: 0,
    loop: true,
  });
  const setTime = useCallback(
    (value: SetStateAction<number>) =>
      dispatch({ type: "time", value, duration }),
    [duration],
  );
  const setPlaying = useCallback(
    (value: SetStateAction<boolean>) => dispatch({ type: "playing", value }),
    [],
  );
  const setLoop = useCallback(
    (value: SetStateAction<boolean>) => dispatch({ type: "loop", value }),
    [],
  );

  useEffect(() => {
    if (!state.playing) return;
    let frame: number;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      dispatch({ type: "tick", delta, duration });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing, duration]);

  return {
    ...state,
    time: Math.min(state.time, duration),
    setTime,
    setPlaying,
    setLoop,
  };
}
export type Playback = ReturnType<typeof usePlayback>;
