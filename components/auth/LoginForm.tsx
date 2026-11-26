"use client";

import { useState, useSyncExternalStore } from "react";
import PageHeader from "@/components/PageHeader";
import SetupNotice from "@/components/SetupNotice";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

function subscribe() {
  return () => {};
}

function readLinkError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return (
    params.get("error_description") ||
    hash.get("error_description") ||
    params.get("error") ||
    hash.get("error")
  );
}

export default function LoginForm() {
  const linkError = useSyncExternalStore(subscribe, readLinkError, () => null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const error = sent ? null : (formError ?? linkError);

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Sign in" subtitle="Email magic link" />
        <SetupNotice />
      </>
    );
  }

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFormError("Enter a valid email address.");
      return;
    }

    setSending(true);
    setFormError(null);
    const { error: signInError } = await createClient().auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSending(false);

    if (signInError) {
      setFormError(signInError.message);
      return;
    }
    setSent(true);
  }

  return (
    <>
      <PageHeader title="Sign in" subtitle="We'll email you a link. No password." />

      {sent ? (
        <div className="rounded-2xl bg-card p-5 space-y-3">
          <p className="font-semibold">Check your email</p>
          <p className="text-sm text-muted">
            Tap the link in the message sent to <span className="text-foreground">{email}</span>.
            Check spam if it doesn&apos;t arrive in a minute. The free Supabase mailer only
            sends a few emails per hour.
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="min-h-12 text-sm font-medium text-accent"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={sendLink} className="rounded-2xl bg-card p-4 space-y-3">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={sending}
            className="w-full min-h-12 rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
          >
            {sending ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-card px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <p className="mt-6 text-sm text-muted">
        Open the link in this same browser. If Gmail opens it somewhere else and sign-in
        fails, use the email template from the setup steps once — after that, the link
        works from the phone.
      </p>
    </>
  );
}
