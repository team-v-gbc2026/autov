import { defineSkill } from "eve/skills";
import {
  TECHNIQUES_BY_FAMILY,
  TECHNIQUES_V2,
} from "../../src/lib/vfx-lab/techniques-v2";
export default defineSkill({
  description:
    "Construction methods for water-projectile VFX, including supported fields, timing and technique IDs.",
  markdown:
    "Use these techniques as construction guidance after establishing user intent. Preserve explicit style, scale, palette and timing. IDs for generate_vfx:\n\n" +
    TECHNIQUES_BY_FAMILY["water-projectile"]
      .map((id) => {
        const card = TECHNIQUES_V2[id];
        return (
          "# " +
          card.name +
          " (" +
          id +
          ")\n" +
          card.use +
          "\n" +
          card.construction.map((step, i) => i + 1 + ". " + step).join("\n") +
          "\nTiming: " +
          card.timing +
          "\nSupported fields: " +
          card.vocabulary.available.join("; ")
        );
      })
      .join("\n\n"),
});
