"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import SetupNotice from "@/components/SetupNotice";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const EMAIL_KEY = "daily-hub-email";
const DEFAULT_EMAIL = "angekk419@gmail.com";

function subscribe() {
  return () => {};
}

function readEmail(): string {
  return localStorage.getItem(EMAIL_KEY) || DEFAULT_EMAIL;
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
  if (/invalid login|invalid credentials/i.test(message)) {
    return "That email or password doesn't match.";
  }
  if (/email not confirmed/i.test(message)) {
    return "That account is waiting for email confirmation. In Supabase, open Authentication, then Sign In / Providers, then Email, and turn off Confirm email. Then sign in again.";
  }
  return message;
}

export default function LoginForm() {
  const router = useRouter();
  const linkError = useSyncExternalStore(subscribe, readLinkError, () => null);
  const remembered = useSyncExternalStore(subscribe, readEmail, () => "");
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const error = formError ?? linkError;
  const emailValue = email ?? remembered;

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Sign in" />
        <SetupNotice />
      </>
    );
  }

  function remember(nextEmail: string) {
    localStorage.setItem(EMAIL_KEY, nextEmail);
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = emailValue.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      setFormError("Enter an email address.");
      return;
    }
    if (password.length < 6) {
      setFormError("Use at least 6 characters.");
      return;
    }

    setSaving(true);
    setFormError(null);
    const supabase = createClient();
    if (creating) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmed,
        password,
        options: { data: { display_name: name.trim() } },
      });
      setSaving(false);
      if (signUpError) {
        setFormError(friendlyPasswordError(signUpError.message));
        return;
      }
      remember(trimmed);
      if (!data.session) {
        setFormError(
          "Account created. Supabase is still waiting to confirm the email. In the Supabase dashboard, open Authentication, then Sign In / Providers, then Email, and turn off Confirm email. Then sign in with this email and password.",
        );
        setCreating(false);
        return;
      }
      router.push("/today");
      router.refresh();
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });
    setSaving(false);
    if (signInError) {
      setFormError(friendlyPasswordError(signInError.message));
      return;
    }
    remember(trimmed);
    router.push("/today");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Daily Hub"
        subtitle={creating ? "Create your own account." : "Sign in with your email and password."}
      />
      <form onSubmit={signIn} className="space-y-3 rounded-2xl bg-card p-4">
        {creating ? (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={40}
              placeholder="Ada"
              className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        ) : null}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={emailValue}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="w-full min-h-12 rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
        >
          {saving ? "Please wait…" : creating ? "Create account" : "Sign in"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setCreating((open) => !open);
          setFormError(null);
        }}
        className="mt-4 min-h-12 w-full text-sm font-medium text-accent"
      >
        {creating ? "I already have an account" : "Create an account"}
      </button>

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-card px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </>
  );
}
