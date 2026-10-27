"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User; roles: string[] | null };

const SessionContext = createContext<SessionState>({ status: "loading" });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    // Fires once with the stored session, then on every sign-in and sign-out.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: "signed-in", user: session.user, roles: null } : { status: "signed-out" });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (state.status !== "signed-in" || state.roles !== null) return;
    let active = true;
    const userId = state.user.id;
    void (async () => {
      const current = await supabase.rpc("current_user_roles");
      if (!active) return;
      if (current.error) {
        setState((state) => state.status === "signed-in" && state.user.id === userId
          ? { ...state, roles: [] }
          : state);
        return;
      }

      let roles = current.data ?? [];
      if (roles.length === 0) {
        const provisioned = await supabase.rpc("bootstrap_patient_role");
        if (provisioned.data && typeof provisioned.data === "object" && "ok" in provisioned.data
          && provisioned.data.ok === true && "roles" in provisioned.data
          && Array.isArray(provisioned.data.roles)) {
          roles = provisioned.data.roles as string[];
        }
      }
      if (!active) return;
      setState((state) => state.status === "signed-in" && state.user.id === userId
        ? { ...state, roles }
        : state);
    })();
    return () => { active = false; };
  }, [state]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/** Shows its children only to a signed-in practitioner. */
export function RequireSession({ children }: { children: (user: User) => ReactNode }) {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "signed-out") router.replace("/sign-in/");
  }, [session.status, router]);

  if (session.status !== "signed-in") {
    return (
      <p role="status" className="wa-page wa-meta">
        Checking who is signed in…
      </p>
    );
  }
  if (session.roles === null) {
    return <p role="status" className="wa-page wa-meta">Checking account access…</p>;
  }
  if (!session.roles.includes("practitioner")) {
    return (
      <p role="alert" className="wa-page wa-meta">
        This account does not have practitioner access.
      </p>
    );
  }
  return <>{children(session.user)}</>;
}

/** Logins are plain names ("nik"); the sign-in service needs an email, so a name stands for name@watson.test. */
const DOMAIN = "@watson.test";
export const loginEmail = (name: string) => (name.includes("@") ? name.trim() : `${name.trim().toLowerCase()}${DOMAIN}`);
export const loginName = (email: string | undefined) => (email?.endsWith(DOMAIN) ? email.slice(0, -DOMAIN.length) : email ?? "");
