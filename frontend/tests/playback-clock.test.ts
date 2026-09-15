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

test("display updates are bounded while the canvas clock stays current", () => {
  const clock = createPlaybackClock(10);
  let updates = 0;
  clock.subscribeDisplay(() => updates++);
  for (let frame = 0; frame < 120; frame++) clock.tick(1 / 120);
  assert.ok(Math.abs(clock.getSnapshot().time - 1) < 1e-6);
  assert.equal(updates, 30);
  clock.tick(1 / 120);
  assert.notEqual(clock.getDisplaySnapshot().time, clock.getSnapshot().time);
  clock.getSnapshot().setPlaying(false);
  assert.equal(clock.getDisplaySnapshot(), clock.getSnapshot());
  clock.getSnapshot().setTime(2.123);
  assert.equal(clock.getDisplaySnapshot().time, 2.123);
  const pausedUpdates = updates;
  for (let frame = 0; frame < 120; frame++) clock.tick(1 / 120);
  assert.equal(updates, pausedUpdates);
});

test("a held clock does not advance while the renderer prepares a document", () => {
  const clock = createPlaybackClock(5);
  clock.tick(0.5);
  assert.equal(clock.getSnapshot().time, 0.5);
  const release = clock.hold();
  assert.equal(clock.held(), true);
  // Preparing a document blocks the main thread; the frames that follow must
  // not hand playback the whole stall at once.
  for (let frame = 0; frame < 60; frame++) clock.tick(0.1);
  assert.equal(clock.getSnapshot().time, 0.5);
  assert.equal(clock.getSnapshot().playing, true);
  // A second holder keeps the timeline suspended until both release it.
  const second = clock.hold();
  release();
  release();
  clock.tick(0.25);
  assert.equal(clock.getSnapshot().time, 0.5);
  second();
  assert.equal(clock.held(), false);
  clock.tick(0.25);
  assert.equal(clock.getSnapshot().time, 0.75);
  // Seeking and pausing still work while held.
  const hold = clock.hold();
  clock.getSnapshot().setTime(2);
  assert.equal(clock.getSnapshot().time, 2);
  hold();
});
