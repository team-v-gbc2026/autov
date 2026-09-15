export type Project = { id: string; name: string; created_at: string; thumbnail_url?: string };
export type Reference = { id: string; name: string; url: string; type: string };
export type Generation = { id: string; prompt: string; status: string; created_at: string; error: string | null };
export type EffectVersion = { id: string; schema_version: string; created_at: string };
