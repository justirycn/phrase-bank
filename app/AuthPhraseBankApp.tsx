"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { PhraseBankApp } from "./PhraseBankApp";
import { CloudPhraseRepository } from "./storage/cloudRepository";
import { installBundledSystemContent } from "./services/systemContentInstaller";
import { createDiagnosticReporter, type DiagnosticReporter } from "./services/diagnostics";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

type ApplicationProps = { repository: CloudPhraseRepository; contentInstaller: typeof installBundledSystemContent; username: string; onLogout: () => Promise<void> };

function accountDatabaseName(username: string) {
  let hash = 2166136261;
  for (const character of username.trim().toLocaleLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `phrase-cloud-v2-${(hash >>> 0).toString(16)}`;
}

type CreateRepository = (request: typeof fetch, username: string, reporter: DiagnosticReporter) => CloudPhraseRepository;

function AuthenticatedApplication({ fetcher, user, logout, renderApp, createRepository, renderApplication }: {
  fetcher: typeof fetch;
  user: { username: string };
  logout: () => Promise<void>;
  renderApp?: (user: { username: string }) => ReactNode;
  createRepository: CreateRepository;
  renderApplication?: (props: ApplicationProps) => ReactNode;
}) {
  const reporter = useMemo(() => createDiagnosticReporter(fetcher), [fetcher]);
  const [repository] = useState(() => createRepository(fetcher, user.username, reporter));
  useEffect(() => () => { void repository.close(); }, [repository]);
  useEffect(() => {
    const context = () => ({ screen: "app" as const, ...(typeof navigator === "undefined" ? {} : { online: navigator.onLine }) });
    const onError = () => reporter("unhandled_error", context());
    const onRejection = () => reporter("unhandled_error", context());
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, [reporter]);
  if (renderApp) return <><div className="account-bar"><span>{user.username}</span><button type="button" onClick={() => { void logout(); }}>退出登录</button></div>{renderApp(user)}</>;
  const applicationProps = { repository, contentInstaller: installBundledSystemContent, username: user.username, onLogout: logout };
  return renderApplication ? renderApplication(applicationProps) : <AppErrorBoundary reporter={reporter}><PhraseBankApp {...applicationProps} /></AppErrorBoundary>;
}

export function AuthPhraseBankApp({ fetcher = fetch, renderApp, createRepository = (request, username, reporter) => new CloudPhraseRepository(request, 15_000, accountDatabaseName(username), reporter), renderApplication }: { fetcher?: typeof fetch; renderApp?: (user: { username: string }) => ReactNode; createRepository?: CreateRepository; renderApplication?: (props: ApplicationProps) => ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; user?: { username: string } }>({ loading: true });
  useEffect(() => { let active = true; void fetcher("/api/auth/session", { credentials: "same-origin" }).then(async (response) => active && setState(response.ok ? { loading: false, user: (await response.json()).user } : { loading: false })).catch(() => active && setState({ loading: false })); return () => { active = false; }; }, [fetcher]);
  if (state.loading) return <main className="loading"><div className="pulse" /><p>正在确认登录状态…</p></main>;
  if (!state.user) return <LoginScreen onLogin={async (username, password) => { const response = await fetcher("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error("login"); setState({ loading: false, user: (await response.json()).user }); }} />;
  const logout = async () => { await fetcher("/api/auth/logout", { method: "POST", credentials: "same-origin" }); setState({ loading: false }); };
  return <AuthenticatedApplication key={state.user.username} fetcher={fetcher} user={state.user} logout={logout} renderApp={renderApp} createRepository={createRepository} renderApplication={renderApplication} />;
}
