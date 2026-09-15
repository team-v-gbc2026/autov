import Review from "./review";
import { createPresetV2 } from "@/lib/vfx-lab/recipes-v2";
export default function Page() {
  return <Review fixture={createPresetV2("beam")} />;
}
