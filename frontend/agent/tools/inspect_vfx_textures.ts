import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { toolIdentity } from "../lib/studio";
import {
  InspectLibraryTexturesSchema,
  inspectLibraryTextures,
} from "../../src/lib/vfx-lab/inspect-library-textures";

export default defineTool({
  description:
    "Inspect pixels and playback metadata for up to four public VFX library textures. Use IDs from read_vfx's texture catalog. Returns whole atlases, not animated playback. This does not create images or board references.",
  inputSchema: InspectLibraryTexturesSchema,
  async execute(input, ctx) {
    await toolIdentity(ctx);
    return inspectLibraryTextures(input);
  },
  toModelOutput(results) {
    return toolOutput.content(
      results.flatMap((result) => [
        toolOutputPart.text(JSON.stringify(result.texture)),
        toolOutputPart.file(result.image, { mediaType: "image/png" }),
      ]),
    );
  },
});
