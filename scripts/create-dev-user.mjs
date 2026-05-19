import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.DEV_USER_EMAIL ?? "johan@jpx.nu";
const password = process.env.DEV_USER_PASSWORD;

if (!url || !secretKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

if (!password) {
  console.error("Set DEV_USER_PASSWORD for the dev user.");
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: {
    organization_id: "org_jpx",
    workspace_id: "workspace_main",
    role: "Admin",
  },
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Dev user ready: ${data.user?.email} (org_jpx / workspace_main via app_metadata)`);
