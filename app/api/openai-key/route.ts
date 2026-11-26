import { createClient } from "@/lib/supabase/server";
import { serverHasFamilyKey } from "@/lib/ai-server";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function missingSettings(message: string): boolean {
  return /relation|schema cache|does not exist|permission denied|user_settings/i.test(message);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);

  const server = serverHasFamilyKey();
  const status = await supabase.rpc("family_ai_status");
  const row = status.error ? null : (status.data as { configured?: boolean; can_manage?: boolean } | null);
  const stored = await supabase.from("user_settings").select("openai_api_key").maybeSingle();
  const own =
    !stored.error && typeof stored.data?.openai_api_key === "string" && stored.data.openai_api_key.trim().startsWith("sk-");

  return json({
    configured: server || Boolean(row?.configured) || own,
    shared: server || Boolean(row?.configured),
    canManage: server ? false : row ? Boolean(row.can_manage) : true,
    server,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);
  if (serverHasFamilyKey()) {
    return json({ error: "The family key is already set on the server. Everyone can use the coach." }, 400);
  }

  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (key && !key.startsWith("sk-")) return json({ error: "An OpenAI key starts with sk-." }, 400);
  if (key.length > 300) return json({ error: "That key is too long." }, 400);

  const status = await supabase.rpc("family_ai_status");
  const canManage = status.error ? true : Boolean((status.data as { can_manage?: boolean } | null)?.can_manage);
  if (!canManage) {
    return json({ error: "Only the person who started the family can save the key." }, 403);
  }

  const saved = await supabase.rpc("save_family_ai_key", { new_key: key });
  const familySaved = !saved.error;
  if (saved.error && !/function|schema cache|does not exist|could not find|NO_HOUSEHOLD/i.test(saved.error.message)) {
    return json({ error: saved.error.message }, 400);
  }

  const { error } = await supabase.from("user_settings").upsert(
    { user_id: user.id, openai_api_key: key || null },
    { onConflict: "user_id" },
  );
  if (error) {
    if (familySaved) {
      return json({
        configured: key.length > 0,
        shared: key.length > 0,
        canManage: true,
        server: false,
        warning: "The family key is saved. Add the Supabase secret key on the server so everyone can use it.",
      });
    }
    if (missingSettings(error.message)) {
      return json({ error: "Saving a key needs the task workout script in the Supabase SQL editor." }, 503);
    }
    return json({ error: error.message }, 500);
  }

  return json({
    configured: key.length > 0,
    shared: familySaved && key.length > 0,
    canManage: true,
    server: false,
    warning: familySaved ? null : "Saved on your account. Run the family AI script so everyone can use the same key.",
  });
}
