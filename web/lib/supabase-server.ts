import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client utilizing the service_role key.
 * This client bypasses RLS on the server and must NEVER be exposed to the browser.
 */
export const sb = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};
