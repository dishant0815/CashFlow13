// app/api/plaid/create-link-token/route.ts
//
// Simple version: build the Plaid client fresh per request, log every step,
// trim env vars to defeat trailing-newline / surrounding-quote issues from
// .env.local copy-paste. No singleton cache, no helper module.

import { NextResponse } from "next/server";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

export const dynamic = "force-dynamic";

export async function POST() {
  console.log("\n[create-link-token] ▶ POST received");

  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  const env = (process.env.PLAID_ENV ?? "sandbox").trim();

  console.log("[create-link-token] env check:", {
    PLAID_CLIENT_ID: clientId
      ? `${clientId.slice(0, 4)}…${clientId.slice(-4)} (${clientId.length} chars)`
      : "❌ MISSING",
    PLAID_SECRET: secret
      ? `${secret.slice(0, 4)}…${secret.slice(-4)} (${secret.length} chars)`
      : "❌ MISSING",
    PLAID_ENV: env,
  });

  if (!clientId || !secret) {
    console.error(
      "[create-link-token] ❌ env vars missing. Set PLAID_CLIENT_ID and PLAID_SECRET in .env.local AND fully restart `npm run dev` (Ctrl+C, then `npm run dev` again — file save is not enough)."
    );
    return NextResponse.json(
      {
        error:
          "PLAID_CLIENT_ID or PLAID_SECRET is missing. Check .env.local and FULLY restart npm run dev.",
      },
      { status: 500 }
    );
  }

  const basePath = PlaidEnvironments[env];
  if (!basePath) {
    console.error(`[create-link-token] ❌ unknown PLAID_ENV: "${env}"`);
    return NextResponse.json(
      { error: `Unknown PLAID_ENV="${env}". Use sandbox | development | production.` },
      { status: 500 }
    );
  }

  const client = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    })
  );

  try {
    console.log("[create-link-token] → calling Plaid linkTokenCreate…");
    const resp = await client.linkTokenCreate({
      user: { client_user_id: "cashflow13-demo-user" },
      client_name: "CashFlow13",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    const token = resp.data.link_token;
    console.log(
      "[create-link-token] ✅ Plaid returned link_token:",
      token.slice(0, 16) + "…"
    );
    return NextResponse.json({ link_token: token });
  } catch (e: unknown) {
    const err = e as { message?: string; response?: { data?: { error_message?: string; error_code?: string; error_type?: string } } };
    const plaid = err.response?.data;
    console.error("[create-link-token] ❌ Plaid call FAILED");
    console.error("  message:    ", err.message);
    console.error("  error_code: ", plaid?.error_code);
    console.error("  error_type: ", plaid?.error_type);
    console.error("  error_msg:  ", plaid?.error_message);
    return NextResponse.json(
      {
        error: plaid?.error_message || err.message || "unknown",
        plaid_error_code: plaid?.error_code,
      },
      { status: 500 }
    );
  }
}
