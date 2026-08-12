"use client";
import { useEffect, useState, type ReactNode } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { PhraseBankApp } from "./PhraseBankApp";
import { CloudPhraseRepository } from "./storage/cloudRepository";

export function AuthPhraseBankApp({ fetcher = fetch, renderApp }: { fetcher?: typeof fetch; renderApp?: (user: { username: string }) => ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; user?: { username: string } }>({ loading: true });
  useEffect(() => { let active = true; void fetcher("/api/auth/session", { credentials: "same-origin" }).then(async (response) => active && setState(response.ok ? { loading: false, user: (await response.json()).user } : { loading: false })).catch(() => active && setState({ loading: false })); return () => { active = false; }; }, [fetcher]);
  if (state.loading) return <main className="loading"><div className="pulse" /><p>正在确认登录状态…</p></main>;
  if (!state.user) return <LoginScreen onLogin={async (username, password) => { const response = await fetcher("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error("login"); setState({ loading: false, user: (await response.json()).user }); }} />;
  const logout = async () => { await fetcher("/api/auth/logout", { method: "POST", credentials: "same-origin" }); setState({ loading: false }); };
  return <><div className="account-bar"><span>{state.user.username}</span><button type="button" onClick={() => { void logout(); }}>退出登录</button></div>
    {renderApp ? renderApp(state.user) : <PhraseBankApp repository={new CloudPhraseRepository(fetcher)} contentInstaller={async () => undefined} />}</>;
}
