/** Conservative visible bounds in a 2x2 XY plane; image rows run top-to-bottom. */
export function textureAlphaBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
) {
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 4) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left) return undefined;
  return {
    minX: Math.max(-1, ((left - 2) / width) * 2 - 1),
    maxX: Math.min(1, ((right + 3) / width) * 2 - 1),
    minY: Math.max(-1, 1 - ((bottom + 3) / height) * 2),
    maxY: Math.min(1, 1 - ((top - 2) / height) * 2),
  };
}
