import { defineTool } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "../lib/studio";
import { verifyIdentity } from "../../src/lib/studio-tools/server";
import { createReferenceImage } from "../../src/lib/reference-images";
import { encodeMention } from "../../src/components/studio/composer/prompt-format";

export default defineTool({
  description: "Generate an image from a prompt and save it on the project reference board. Supply referenceId to edit an existing board image instead; the original is preserved. Use for explicit image creation/editing requests, not VFX generation. Returns a reference tag; inspect_references can inspect the saved pixels.",
  inputSchema: z.object({ prompt: z.string().trim().min(1).max(2000), referenceId: z.string().uuid().optional() }).strict(),
  async execute(input, ctx) {
    const identity = await toolIdentity(ctx);
    const client = await verifyIdentity(identity);
    try {
      const image = await createReferenceImage(client, identity.projectId, identity.userId, input, ctx.abortSignal ?? new AbortController().signal);
      return { referenceId: image.id, name: image.name, tag: encodeMention(image.id, image.name), summary: "Image saved to the reference board." };
    } catch {
      throw new Error("Image creation did not complete successfully. Check the reference board before retrying; do not automatically repeat a request with an unknown outcome. Verify image-model access and API quota.");
    }
  },
});
