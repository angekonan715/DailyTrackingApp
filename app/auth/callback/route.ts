import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function isOtpType(value: string | null): value is EmailOtpType {
  return !!value && OTP_TYPES.has(value as EmailOtpType);
}

function loginError(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(message)}`, origin),
  );
}

// Finishes a magic-link sign-in. Supports the token_hash link (works from the
// Gmail app) and the default same-browser code link.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const described = url.searchParams.get("error_description");
  if (described) return loginError(origin, described);

  const supabase = await createClient();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL("/today", origin));
    return loginError(origin, error.message);
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/today", origin));
    return loginError(
      origin,
      "That link expired or was opened in a different browser. Request a new one, and use the email template from the setup steps so it works from your phone.",
    );
  }

  return loginError(origin, "That sign-in link is invalid or expired. Request a new one.");
}
