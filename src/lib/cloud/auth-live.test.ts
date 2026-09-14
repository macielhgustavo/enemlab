import { describe, expect, it } from "vitest";

const SUPABASE_URL = "https://srpohfgqqrzpilalemar.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rQ-ylXrjxjUbp0kHXsXidQ_dz-P4cQl";

describe("canonical Supabase Auth", () => {
  it(
    "keeps email/password enabled without creating a user",
    async () => {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "studium-auth-smoke@example.invalid",
          password: "not-a-real-account-password",
        }),
      });

      const body = await response.text();
      expect(body).not.toMatch(/email logins? (are )?disabled/i);
      expect(response.status).toBe(400);
      expect(body).toMatch(/invalid login credentials/i);
    },
    20_000,
  );
});
