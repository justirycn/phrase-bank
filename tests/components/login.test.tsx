import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
});
