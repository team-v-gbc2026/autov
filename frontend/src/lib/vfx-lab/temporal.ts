/** Rendered activity is diagnostic evidence, never a visual acceptance gate. */
export type TemporalDiagnostics = {
  sampleRate: number;
  frames: number;
  lowActivityIntervals: [number, number][];
  abruptDrops: { time: number; before: number; after: number }[];
  activityCurve: [number, number][];
};
export function summarizeActivity(
  energies: readonly number[],
  sampleRate = 30,
  duration = (energies.length - 1) / sampleRate,
): TemporalDiagnostics {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    sampleRate > 60 ||
    energies.length < 2 ||
    energies.length > 721 ||
    energies.some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new Error("Invalid activity samples");
  const peak = Math.max(...energies),
    activity = energies.map((v) => (peak ? v / peak : 0));
  const round = (v: number) => Number(v.toFixed(4));
  const at = (i: number) => round(Math.min(duration, i / sampleRate));
  const first = activity.findIndex((v) => v > 0.02);
  const last = activity.findLastIndex((v) => v > 0.02);
  const lowActivityIntervals: [number, number][] = [];
  for (let i = first + 1; first >= 0 && i < last; i++) {
    if (activity[i] > 0.02) continue;
    const start = i;
    while (i + 1 < last && activity[i + 1] <= 0.02) i++;
    if (i - start + 1 >= 2) lowActivityIntervals.push([at(start), at(i)]);
  }
  const abruptDrops = activity.flatMap((v, i) =>
    i && activity[i - 1] > 0.1 && v < activity[i - 1] * 0.35
      ? [{ time: at(i), before: round(activity[i - 1]), after: round(v) }]
      : [],
  );
  const indices = new Set(
    Array.from({ length: Math.min(41, activity.length) }, (_, i) =>
      Math.round(
        (i * (activity.length - 1)) / (Math.min(41, activity.length) - 1),
      ),
    ),
  );
  return {
    sampleRate,
    frames: activity.length,
    lowActivityIntervals: lowActivityIntervals.slice(0, 24),
    abruptDrops: abruptDrops.slice(0, 24),
    activityCurve: [...indices].map((i) => [at(i), round(activity[i])]),
  };
}
/** Total visible RGB change against a rendered, extinguished baseline. Alpha ignored. */
export function measureFrameActivity(
  pixels: ArrayLike<number>,
  baseline: ArrayLike<number>,
) {
  if (pixels.length !== baseline.length || pixels.length % 4 !== 0)
    throw new Error("Activity frame size mismatch");
  let energy = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const delta = Math.max(
      Math.abs(pixels[i] - baseline[i]),
      Math.abs(pixels[i + 1] - baseline[i + 1]),
      Math.abs(pixels[i + 2] - baseline[i + 2]),
    );
    if (delta > 12) energy += delta;
  }
  return energy;
}
