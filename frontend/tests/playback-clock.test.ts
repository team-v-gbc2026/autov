import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackClock } from "../src/components/studio/playback-clock";

test("clock publishes playback changes without publishing paused ticks", () => {
  const clock = createPlaybackClock(3);
  let updates = 0;
  const unsubscribe = clock.subscribe(() => updates++);
  clock.tick(0.5);
  assert.equal(clock.getSnapshot().time, 0.5);
  clock.getSnapshot().setPlaying(false);
  const paused = clock.getSnapshot();
  const count = updates;
  for (let i = 0; i < 120; i++) clock.tick(1 / 60);
  assert.equal(updates, count);
  assert.equal(clock.getSnapshot(), paused);
  clock.getSnapshot().setTime(1.2);
  assert.equal(clock.getSnapshot().time, 1.2);
  unsubscribe();
  const last = updates;
  clock.getSnapshot().setTime(0);
  assert.equal(updates, last);
});

test("looping, stopping at the end, functional setters, and duration changes", () => {
  const clock = createPlaybackClock(3);
  clock.getSnapshot().setTime(2.9);
  clock.tick(0.2);
  assert.ok(Math.abs(clock.getSnapshot().time - 0.1) < 1e-6);
  clock.getSnapshot().setLoop(value => !value);
  clock.getSnapshot().setTime(2.9);
  clock.tick(0.2);
  assert.equal(clock.getSnapshot().time, 3);
  assert.equal(clock.getSnapshot().playing, false);
  clock.setDuration(1);
  assert.equal(clock.getSnapshot().time, 1);
  clock.getSnapshot().setTime(value => value - 0.5);
  assert.equal(clock.getSnapshot().time, 0.5);
});
