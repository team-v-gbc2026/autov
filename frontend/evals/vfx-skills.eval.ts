import { defineEval } from "eve/evals";
export default defineEval({
  async test(t) {
    await t.send(
      "Explain how you would construct a cel-shaded smoke burst using your VFX skills. Load the authoring and smoke technique skills, but do not generate or change any effect yet.",
    );
    t.succeeded();
    t.loadedSkill("vfx-authoring");
    t.loadedSkill("vfx-techniques-smoke-burst");
    t.notCalledTool("generate_vfx");
    t.notCalledTool("commit_vfx_candidate");
  },
});
