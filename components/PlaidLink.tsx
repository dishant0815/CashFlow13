"use client";

// Fake-door PlaidLink.
//
// Phase 1 of the deployment refactor: keep react-plaid-link so the user
// gets the real sandbox bank-login modal, but skip the public_token
// exchange and skip the /api/plaid/sync round-trip. On Plaid's onSuccess
// we just fire onConnected() and let the parent run the visual pipeline
// + load the cached Retail scenario.
//
// If the link_token request fails (e.g. no Plaid env vars on the deployed
// build), we fall back to firing onConnected() directly so the demo never
// "dies on click" in front of a recruiter.

import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

interface Props {
  /** Parent flips this true when the user clicks Connect Bank. */
  open: boolean;
  /** Fires either after the Plaid modal succeeds OR on fake-door fallback. */
  onConnected: () => void;
  /** User closed the modal without completing. */
  onAbort: () => void;
}

export function PlaidLinkLauncher({ open, onConnected, onAbort }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [tokenFailed, setTokenFailed] = useState(false);

  // Fetch link_token on mount so it's ready by click time.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { link_token?: string }) => {
        if (cancelled) return;
        if (data.link_token) {
          setToken(data.link_token);
        } else {
          setTokenFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setTokenFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { open: openPlaid, ready } = usePlaidLink({
    token,
    onSuccess: () => {
      // Fake door: no exchange, no sync. Straight to the pipeline.
      onConnected();
    },
    onExit: () => onAbort(),
  });

  // When parent asks to open: use real Plaid if ready, otherwise skip
  // straight to the pipeline so the demo always advances.
  useEffect(() => {
    if (!open) return;
    if (ready && token) {
      openPlaid();
    } else if (tokenFailed) {
      onConnected();
    }
  }, [open, ready, token, tokenFailed, openPlaid, onConnected]);

  return null;
}
