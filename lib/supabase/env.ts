/** Public Supabase settings. The anon key is safe in the browser; never put the secret key here. */
export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

export function supabaseKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

export function isSupabaseConfigured(): boolean {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return false;
  if (url.includes("your-project.supabase.co")) return false;
  if (key === "your-anon-key") return false;
  return true;
}
