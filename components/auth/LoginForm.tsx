"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import SetupNotice from "@/components/SetupNotice";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** This personal app has one account. The password is what you choose in Supabase. */
const ACCOUNT_EMAIL = "angekk419@gmail.com";

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

function friendlyPasswordError(message: string): string {
  if (/invalid login|invalid credentials|email not confirmed/i.test(message)) {
    return "That password doesn't match.";
  }
  return message;
}

export default function LoginForm() {
  const router = useRouter();
  const linkError = useSyncExternalStore(subscribe, readLinkError, () => null);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const error = formError ?? linkError;

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Sign in" />
        <SetupNotice />
      </>
    );
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 6) {
      setFormError("Use at least 6 characters.");
      return;
    }

    setSaving(true);
    setFormError(null);
    const { error: signInError } = await createClient().auth.signInWithPassword({
      email: ACCOUNT_EMAIL,
      password,
    });
    setSaving(false);

    if (signInError) {
      setFormError(friendlyPasswordError(signInError.message));
      return;
    }
    router.push("/today");
    router.refresh();
  }

  return (
    <>
      <PageHeader title="Daily Hub" subtitle="Enter your password." />
      <form onSubmit={signIn} className="rounded-2xl bg-card p-4 space-y-3">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={saving}
          className="w-full min-h-12 rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
        >
          {saving ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-card px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </>
  );
}
