import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { COACH_MODEL, MONTHLY_CAP_CENTS, estimateCents } from "@/lib/coach";

export interface Spend {
  householdCents: number;
  ownCents: number;
  shared: boolean;
}

export function serverHasFamilyKey(): boolean {
  return (process.env.AI_API_KEY?.trim() ?? "").startsWith("sk-");
}

export async function resolveApiKey(supabase: SupabaseClient, userId: string): Promise<string> {
  if (serverHasFamilyKey()) return process.env.AI_API_KEY!.trim();

  const admin = createAdminClient();
  if (admin) {
    const { data, error } = await admin.rpc("family_openai_key_for", { member: userId });
    if (!error && typeof data === "string" && data.trim().startsWith("sk-")) return data.trim();
  }

  const stored = await supabase.from("user_settings").select("openai_api_key").maybeSingle();
  const own = typeof stored.data?.openai_api_key === "string" ? stored.data.openai_api_key.trim() : "";
  return own.startsWith("sk-") ? own : "";
}

export async function loadSpend(supabase: SupabaseClient, month: string): Promise<Spend> {
  const [usage, shared] = await Promise.all([
    supabase.from("ai_usage").select("cost_cents").eq("month", month).maybeSingle(),
    supabase.rpc("household_ai_cents", { target_month: month }),
  ]);
  if (usage.error && !/relation|schema cache|does not exist|ai_usage/i.test(usage.error.message)) {
    throw new Error(usage.error.message);
  }
  const ownCents = Number(usage.data?.cost_cents ?? 0);
  const sharedOk = !shared.error && shared.data != null;
  return {
    ownCents,
    householdCents: sharedOk ? Number(shared.data) : ownCents,
    shared: sharedOk,
  };
}

export async function recordSpend(
  supabase: SupabaseClient,
  userId: string,
  month: string,
  ownCents: number,
  spent: number,
): Promise<number> {
  const nextOwn = Math.round((ownCents + spent) * 10_000) / 10_000;
  const { error } = await supabase.from("ai_usage").upsert(
    { user_id: userId, month, cost_cents: nextOwn },
    { onConflict: "user_id,month" },
  );
  if (error) throw new Error(error.message);
  return nextOwn;
}

export function overCap(cents: number): boolean {
  return cents >= MONTHLY_CAP_CENTS;
}

export const CAP_MESSAGE = "The family coach has reached the $5 limit for this month. It will work again next month.";
export const MISSING_KEY_MESSAGE =
  "The coach is not set up on this website yet. Add the key in the website settings, then publish again.";
export const NEEDS_SERVER_MESSAGE =
  "The family key is saved. Add the Supabase secret key on the server so everyone can use the coach.";

export async function coachAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ key: string } | { code: "missing_key" | "needs_server"; message: string }> {
  const key = await resolveApiKey(supabase, userId);
  if (key) return { key };
  const status = await supabase.rpc("family_ai_status");
  const configured = !status.error && Boolean((status.data as { configured?: boolean } | null)?.configured);
  if (configured) return { code: "needs_server", message: NEEDS_SERVER_MESSAGE };
  return { code: "missing_key", message: MISSING_KEY_MESSAGE };
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function completeChat(apiKey: string, messages: ChatMessage[], maxTokens: number, json: boolean) {
  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: COACH_MODEL,
        temperature: 0.7,
        max_tokens: maxTokens,
        response_format: json ? { type: "json_object" } : undefined,
        messages,
      }),
    });
  } catch {
    return { error: "The coach did not answer. Try again in a minute.", status: 502 as const };
  }

  if (!upstream.ok) {
    const detail = (await upstream.json().catch(() => null)) as { error?: { message?: string } } | null;
    const message =
      upstream.status === 401
        ? "OpenAI rejected that key. Check it and save it again."
        : (detail?.error?.message ?? "The coach did not answer. Try again in a minute.");
    return { error: message, status: 502 as const };
  }

  const payload = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: payload.choices?.[0]?.message?.content ?? "",
    spent: estimateCents(payload.usage?.prompt_tokens ?? null, payload.usage?.completion_tokens ?? null),
  };
}
