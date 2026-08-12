"use client";
import { useState } from "react";

export function LoginScreen({ onLogin }: { onLogin(username: string, password: string): Promise<void> }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <main className="login-screen"><section className="login-card"><h1>登录 Phrase Bank</h1><p>使用分配给你的账号继续学习</p>
    <form onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(""); void onLogin(username, password).catch(() => setError("账号或密码错误")).finally(() => setBusy(false)); }}>
      <label>账号<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
      <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p role="alert">{error}</p>}<button disabled={busy} type="submit">{busy ? "正在登录…" : "登录"}</button>
    </form></section></main>;
}
