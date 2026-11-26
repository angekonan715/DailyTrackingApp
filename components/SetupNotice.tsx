export default function SetupNotice() {
  return (
    <div className="rounded-2xl bg-card p-5 text-sm space-y-3">
      <p className="font-semibold text-base">Connect Supabase first</p>
      <p className="text-muted">
        Daily Hub stores your lists in a free Supabase project. Nothing is wired up until
        you add the keys.
      </p>
      <ol className="list-decimal pl-5 space-y-2 text-muted">
        <li>Create a free project at supabase.com.</li>
        <li>
          Open the SQL Editor, paste <span className="text-foreground">supabase/migrations/0001_init.sql</span>,
          and run it.
        </li>
        <li>
          Copy the project URL and the anon (public) key into <span className="text-foreground">.env.local</span>.
          Use the names in <span className="text-foreground">.env.example</span>.
        </li>
        <li>
          Under Authentication → URL Configuration, set the site URL to{" "}
          <span className="text-foreground">http://localhost:3000</span> and add{" "}
          <span className="text-foreground">http://localhost:3000/auth/callback</span> as a
          redirect URL.
        </li>
        <li>Restart the dev server.</li>
      </ol>
    </div>
  );
}
