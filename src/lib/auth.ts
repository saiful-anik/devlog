import { supabase } from "@/lib/supabase";
import { resetStoreSync } from "@/lib/store";

export interface AuthSession {
  id: string;
  name: string;
  provider: "github";
  isGuest: boolean;
  createdAt: string;
}

export async function getSession(): Promise<AuthSession | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) return null;

  const user = data.session?.user;
  if (!user) return null;

  return {
    id: user.id,
    name: user.user_metadata?.name ?? user.user_metadata?.user_name ?? user.email ?? "GitHub User",
    provider: "github",
    isGuest: false,
    createdAt: user.created_at ?? new Date().toISOString(),
  };
}

export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await getSession());
}

export async function signInWithGitHub(redirectPath = "/") {
  if (!supabase) {
    throw new Error("Supabase configuration is missing.");
  }

  const redirectTo = new URL("/login", window.location.origin);
  redirectTo.searchParams.set("next", redirectPath);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: redirectTo.toString(),
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error) throw error;
}

export async function logout(): Promise<void> {
  if (!supabase) return;
  await resetStoreSync();
  await supabase.auth.signOut({ scope: "global" });
}
