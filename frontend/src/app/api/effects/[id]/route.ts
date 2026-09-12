import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { data, error } = await supabase.from("effect_versions").select("definition").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load effect" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(data.definition, null, 2), { headers: {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="effect-${id}.json"`,
    "Cache-Control": "private, no-store",
  } });
}
