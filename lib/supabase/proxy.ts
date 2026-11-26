import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseKey, supabaseUrl } from "@/lib/supabase/env";

function isAuthCallback(pathname: string): boolean {
  return pathname.startsWith("/auth");
}

function isPublicAsset(pathname: string): boolean {
  return pathname === "/sw.js" || pathname === "/manifest.webmanifest";
}

/** Copy refreshed auth cookies onto a redirect so the browser keeps the session. */
function redirectKeepingCookies(from: NextResponse, url: URL): NextResponse {
  const redirect = NextResponse.redirect(url);
  const cookieHeaders =
    typeof from.headers.getSetCookie === "function" ? from.headers.getSetCookie() : [];
  for (const cookie of cookieHeaders) {
    redirect.headers.append("set-cookie", cookie);
  }
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The email link lands here with a one-time code. Don't refresh the session
  // on this request or the code-verifier cookie can be overwritten.
  if (isAuthCallback(pathname) || isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  if (!isSupabaseConfigured()) {
    if (pathname.startsWith("/login")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value),
        );
      },
    },
  });

  // Verifies the session cookie and refreshes it when it's close to expiring.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims);
  } catch {
    signedIn = false;
  }

  if (!signedIn && !pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    return redirectKeepingCookies(supabaseResponse, url);
  }

  return supabaseResponse;
}
