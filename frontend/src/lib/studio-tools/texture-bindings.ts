import type { AuthoringDirection } from "./art-direction";
import { OperationError } from "./operations";

export function resolveTextureBindings(
  needs: AuthoringDirection["art"]["textureNeeds"],
  textures: AuthoringDirection["textures"],
  allowed: ReadonlySet<string>,
): AuthoringDirection["textures"] {
  if (textures.bindings.length !== needs.length)
    throw new OperationError(
      "INVALID_INPUT",
      "Provide exactly one texture binding for each texture need.",
    );
  for (const binding of textures.bindings) {
    if (binding.textureId !== null && !allowed.has(binding.textureId))
      throw new OperationError(
        "INVALID_INPUT",
        `Texture "${binding.textureId}" for role "${binding.role}" was not supplied. Include its library ID in textureIds or its generated texture operation in effectTextureOperationIds.`,
      );
  }

  const remaining = new Set(textures.bindings);
  const resolved = new Map<number, (typeof textures.bindings)[number]>();
  // Resolve exact roles first, independent of array order. Descriptive labels
  // may vary; a unique shared candidate texture ID is a safe fallback.
  for (const [index, need] of needs.entries()) {
    const matches = [...remaining].filter(
      (binding) => binding.role === need.role,
    );
    if (matches.length === 1) {
      resolved.set(index, matches[0]);
      remaining.delete(matches[0]);
    }
  }
  for (const [index, need] of needs.entries()) {
    if (resolved.has(index)) continue;
    const matches = [...remaining].filter(
      (binding) =>
        need.candidateTextureId !== null &&
        binding.textureId === need.candidateTextureId,
    );
    const competingNeeds = needs.filter(
      (other, otherIndex) =>
        !resolved.has(otherIndex) &&
        other.candidateTextureId === need.candidateTextureId,
    );
    if (matches.length !== 1 || competingNeeds.length !== 1)
      throw new OperationError(
        "INVALID_INPUT",
        `Cannot uniquely match texture need "${need.role}". Use that exact role in its binding; texture IDs alone are ambiguous or do not match.`,
      );
    resolved.set(index, matches[0]);
    remaining.delete(matches[0]);
  }
  return {
    bindings: needs.map((need, index) => ({
      ...resolved.get(index)!,
      role: need.role,
    })),
  };
}
