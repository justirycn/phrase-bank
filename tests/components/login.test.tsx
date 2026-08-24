import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloudPhraseRepository } from "../../app/storage/cloudRepository";
import { AuthPhraseBankApp } from "../../app/AuthPhraseBankApp";

describe("AuthPhraseBankApp", () => {
  it("shows login first and enters after valid credentials", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith("/session")
      ? Response.json({}, { status: 401 })
      : Response.json({ user: { username: "alice" } }));
    render(<AuthPhraseBankApp fetcher={fetcher} renderApp={({ username }) => <h1>欢迎 {username}</h1>} />);
    expect(await screen.findByRole("heading", { name: "登录 Phrase Bank" })).toBeVisible();
    await user.type(screen.getByLabelText("账号"), "alice"); await user.type(screen.getByLabelText("密码"), "1234"); await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("heading", { name: "欢迎 alice" })).toBeVisible();
  });

  it("logs out and removes protected content", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith("/session")
      ? Response.json({ user: { username: "alice" } })
      : Response.json({ ok: true }));
    render(<AuthPhraseBankApp fetcher={fetcher} renderApp={({ username }) => <h1>欢迎 {username}</h1>} />);
    expect(await screen.findByText("欢迎 alice")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("heading", { name: "登录 Phrase Bank" })).toBeVisible();
    expect(screen.queryByText("欢迎 alice")).not.toBeInTheDocument();
  });

  it("keeps one cloud repository instance for the signed-in account", async () => {
    const created: CloudPhraseRepository[] = [];
    const fetcher = vi.fn(async () => Response.json({ user: { username: "alice" } }));
    const view = render(<AuthPhraseBankApp fetcher={fetcher} createRepository={() => { const repo = new CloudPhraseRepository(fetcher); created.push(repo); return repo; }} renderApp={() => <p>ready</p>} />);
    await screen.findByText("ready"); view.rerender(<AuthPhraseBankApp fetcher={fetcher} createRepository={() => { const repo = new CloudPhraseRepository(fetcher); created.push(repo); return repo; }} renderApp={() => <p>ready</p>} />);
    expect(created).toHaveLength(1);
  });

  it("creates a new account-scoped repository after logout and another login", async () => {
    const user = userEvent.setup();
    let currentUser = "alice";
    const createdFor: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/session")) return Response.json({ user: { username: currentUser } });
      if (path.endsWith("/logout")) return Response.json({ ok: true });
      if (path.endsWith("/login") && init?.method === "POST") {
        currentUser = "bob";
        return Response.json({ user: { username: currentUser } });
      }
      return Response.json({ ok: true });
    });
    render(<AuthPhraseBankApp fetcher={fetcher} createRepository={(_request, username) => {
      createdFor.push(username);
      return new CloudPhraseRepository(fetcher);
    }} renderApp={({ username }) => <p>ready {username}</p>} />);
    expect(await screen.findByText("ready alice")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    await user.type(screen.getByLabelText("账号"), "bob");
    await user.type(screen.getByLabelText("密码"), "2");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("ready bob")).toBeVisible();
    expect(createdFor).toEqual(["alice", "bob"]);
  });

  it("passes cloud content installation to the application", async () => {
    const fetcher = vi.fn(async () => Response.json({ user: { username: "alice" } }));
    const renderApplication = vi.fn(() => <p>cloud app</p>);
    render(<AuthPhraseBankApp fetcher={fetcher} renderApplication={renderApplication} />);
    await screen.findByText("cloud app");
    expect(renderApplication).toHaveBeenCalledWith(expect.objectContaining({ contentInstaller: expect.any(Function), username: "alice", onLogout: expect.any(Function) }));
    expect(screen.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument();
  });
});
