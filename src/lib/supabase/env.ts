import "server-only";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function getSupabaseEnv() {
  const missingVariables = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !supabasePublishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter((name): name is string => Boolean(name));

  if (missingVariables.length > 0) {
    throw new Error(
      `Не заданы переменные окружения Supabase: ${missingVariables.join(", ")}. Добавьте их в .env.local.`,
    );
  }

  return {
    supabaseUrl: supabaseUrl!,
    supabasePublishableKey: supabasePublishableKey!,
  };
}

export function getSupabaseAdminEnv() {
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseSecretKey) {
    throw new Error(
      "Не задана серверная переменная окружения Supabase: SUPABASE_SECRET_KEY. Добавьте её в .env.local.",
    );
  }

  const { supabaseUrl } = getSupabaseEnv();

  return {
    supabaseUrl,
    supabaseSecretKey,
  };
}
