import { defineAgent, defineDynamic } from "eve";
import { studioModel } from "./lib/model";

export default defineAgent({
  model: defineDynamic({ events: { "step.started": () => studioModel() } }),
  defaultTools: false,
  reasoning: "low",
  limits: { sessionTimeoutMs: false },
});
