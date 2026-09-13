import type { Reference } from "../project-types";
export const MAX_PROMPT_CHARACTERS = 10000;
export const MAX_PROMPT_REFERENCES = 8;
/**
 * Longest reference data URL the local API accepts (its `imageSchema` bound).
 * Shared so the client rejects an oversized image before spending a request.
 */
export const MAX_REFERENCE_CHARACTERS = 2_000_000;
/** Keep image attachment order identical to the stable @mention order. */
export function referenceInput(
  prompt: string,
  ids: string[],
  references: Reference[],
) {
  if (!prompt.trim() || prompt.length > MAX_PROMPT_CHARACTERS)
    throw new Error("Keep the prompt between 1 and 10,000 characters.");
  const unique = [...new Set(ids)];
  if (unique.length > MAX_PROMPT_REFERENCES)
    throw new Error("Use up to 8 references per prompt.");
  const selected = unique.map((id) => {
    const ref = references.find((r) => r.id === id);
    if (!ref)
      throw new Error(
        "A referenced image is unavailable. Remove or replace its @mention.",
      );
    return ref;
  });
  return {
    prompt,
    selected,
    context: selected
      .map((r, i) => `Image ${i + 1}: @${r.name} (reference:${r.id})`)
      .join("\n"),
  };
}
