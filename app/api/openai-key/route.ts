import { createClient } from "@/lib/supabase/server";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);

  const { data, error } = await supabase.from("user_settings").select("openai_api_key").maybeSingle();
  if (error) {
    if (/relation|schema cache|does not exist|permission denied/i.test(error.message)) {
      return json(
        {
          configured: false,
          error:
            "Open the Supabase SQL Editor, paste supabase/migrations/0006_task_workouts.sql, and run it.",
        },
        503,
      );
    }
    return json({ error: error.message }, 500);
  }
  const key = typeof data?.openai_api_key === "string" ? data.openai_api_key.trim() : "";
  return json({ configured: key.length > 0 });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);

  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (key && !key.startsWith("sk-")) {
    return json({ error: "An OpenAI key starts with sk-." }, 400);
  }

  const { error } = await supabase.from("user_settings").upsert(
    { user_id: user.id, openai_api_key: key || null },
    { onConflict: "user_id" },
  );
  if (error) {
    if (/relation|schema cache|does not exist|permission denied/i.test(error.message)) {
      return json(
        {
          error:
            "Open the Supabase SQL Editor, paste supabase/migrations/0006_task_workouts.sql, and run it.",
        },
        503,
      );
    }
    return json({ error: error.message }, 500);
  }
  return json({ configured: key.length > 0 });
}
