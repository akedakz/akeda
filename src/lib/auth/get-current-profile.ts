import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import type { Profile } from "@/types/profile";
import { createClient } from "@/lib/supabase/server";

type CurrentProfile = {
  user: User;
  profile: Profile | null;
};

export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, student_status, avatar_path, avatar_updated_at")
    .eq("id", user.id)
    .maybeSingle();

  return {
    user,
    profile: profileError ? null : (profile as Profile | null),
  };
});
