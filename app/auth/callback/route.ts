import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

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

interface PendingCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

// Finishes a magic-link sign-in. Supports the token_hash link (works from the
// Gmail app) and the default same-browser code link.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const described = url.searchParams.get("error_description");
  if (described) return loginError(origin, described);

  const pending: PendingCookie[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          pending.splice(0, pending.length, ...cookiesToSet);
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        },
      },
    },
  );

  function redirectWithSession(path: string) {
    const response = NextResponse.redirect(new URL(path, origin));
    pending.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    return response;
  }

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return redirectWithSession("/today");
    return loginError(origin, error.message);
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectWithSession("/today");
    return loginError(
      origin,
      "That link expired or was opened in a different browser. Request a new one from the same phone browser, then open the email in that browser.",
    );
  }

  return loginError(origin, "That sign-in link is invalid or expired. Request a new one.");
}
