"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "../../../lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      window.location.href = "/today";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Inloggningen misslyckades.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Logga in</h1>
        <p className="text-muted-foreground text-sm">JPX Accounting — normal läge</p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1 text-sm">
          E-post
          <input
            className="rounded-md border px-3 py-2"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Lösenord
          <input
            className="rounded-md border px-3 py-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          className="rounded-md bg-teal-700 px-4 py-2 text-white disabled:opacity-50"
          type="submit"
          disabled={loading}
        >
          {loading ? "Loggar in…" : "Logga in"}
        </button>
      </form>
    </main>
  );
}
