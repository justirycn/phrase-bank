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
});
