import { afterEach, describe, expect, it, vi } from "vitest";
import { signUpWithEmail, updatePasswordWithSession, type AuthSession } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
});

describe("cloud auth client", () => {
  it("não finge que enviou confirmação quando o e-mail já pertence a OAuth", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "existing@example.com",
            identities: [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as typeof fetch;

    await expect(signUpWithEmail("existing@example.com", "valid-password")).rejects.toThrow(
      "já pertence a uma conta existente",
    );
  });

  it("mantém o fluxo normal de confirmação para um signup novo", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "new@example.com",
            identities: [{ provider: "email" }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as typeof fetch;

    await expect(signUpWithEmail("new@example.com", "valid-password")).resolves.toBeNull();
  });

  it("adiciona senha à conta autenticada sem trocar o usuário", async () => {
    const session: AuthSession = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "33333333-3333-4333-8333-333333333333", email: "oauth@example.com" },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: session.user!.id,
          email: session.user!.email,
          identities: [{ provider: "github" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const user = await updatePasswordWithSession(session, "new-valid-password");

    expect(user.id).toBe(session.user!.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/auth/v1/user");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ Authorization: "Bearer access-token" });
    expect(JSON.parse(String(init.body))).toEqual({ password: "new-valid-password" });
  });
});
