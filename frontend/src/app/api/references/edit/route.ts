import { handleReferenceImage } from "@/lib/reference-images";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) { return handleReferenceImage(request, true); }
