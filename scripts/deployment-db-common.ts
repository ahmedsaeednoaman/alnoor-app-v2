import { URL } from "node:url";
import * as argon2 from "argon2";

export const RUNTIME_DELETE_TABLES = [
  "operation_financial_payments",
  "doctor_account_postings",
  "operation_financial_items",
  "operation_tax_invoices",
  "operation_financial_reviews",
  "operation_consumables",
  "operation_equipment",
  "operation_field_reference_values",
  "operation_field_values",
  "operation_participants",
  "operation_procedures",
  "operation_stents",
  "push_dispatch_claims",
  "operations",
  "doctor_payments",
  "doctor_account_adjustments",
  "doctor_supply_issue_items",
  "doctor_supply_issues",
  "company_expenses",
  "push_subscriptions",
  "sessions",
  "user_permission_overrides",
  "users",
] as const;

export const PRESERVED_MASTER_TABLES = [
  "roles",
  "permissions",
  "role_permissions",
  "doctors",
  "hospitals",
  "procedures",
  "equipment",
  "anesthesia_types",
  "anesthesiologists",
  "technicians",
  "consumables",
  "stents",
  "contract_entities",
  "financial_item_catalog",
  "financial_review_definitions",
  "lithotripsy_pricing_definitions",
  "lithotripsy_pricing_profiles",
  "lithotripsy_pricing_profile_lines",
  "lithotripsy_pricing_profile_procedures",
  "service_pricing_profiles",
  "service_pricing_items",
  "work_form_templates",
  "work_form_sections",
  "work_form_fields",
  "expense_categories",
  "lithotripsy_sessions",
] as const;

export const CONDITIONAL_TABLES = [] as const;

export const DEPLOYMENT_USERS = [
  { username: "ahmed", displayName: "أحمد", role: "owner", env: "ALNOOR_DEPLOY_OWNER_AHMED_PASSWORD" },
  { username: "noaman", displayName: "نعمان", role: "owner", env: "ALNOOR_DEPLOY_OWNER_NOAMAN_PASSWORD" },
  { username: "nour", displayName: "نور", role: "accountant", env: "ALNOOR_DEPLOY_ACCOUNTANT_NOUR_PASSWORD" },
  { username: "abla", displayName: "عبلة", role: "employee", env: "ALNOOR_DEPLOY_EMPLOYEE_ABLA_PASSWORD" },
  { username: "wedad", displayName: "وداد", role: "employee", env: "ALNOOR_DEPLOY_EMPLOYEE_WEDAD_PASSWORD" },
  { username: "mohamed", displayName: "محمد", role: "employee", env: "ALNOOR_DEPLOY_EMPLOYEE_MOHAMED_PASSWORD" },
] as const;

export function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function parseDatabaseTarget(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return {
    host,
    port: parsed.port || (parsed.protocol === "postgres:" ? "5432" : "5432"),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    user: decodeURIComponent(parsed.username),
    classification: local ? "LOCAL" : "REMOTE",
  } as const;
}

export function passwordValuesFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return DEPLOYMENT_USERS.map((user) => ({ ...user, password: env[user.env] ?? "" }));
}

export function assertPasswordPolicy(values = passwordValuesFromEnv()) {
  for (const value of values) {
    if (!value.password) throw new Error(`${value.env} is required`);
    if (value.password.length < 8 || value.password.length > 128) {
      throw new Error(`${value.env} does not satisfy the current password length policy`);
    }
  }
}

export async function hashDeploymentPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function hasFlag(flag: string, argv = process.argv.slice(2)) {
  return argv.includes(flag);
}

export function assertExecuteGuards(
  target: ReturnType<typeof parseDatabaseTarget>,
  argv: string[],
  resetToken: string,
  remoteToken: string,
) {
  if (!argv.includes("--execute")) throw new Error("REFUSED: --execute is required");
  if (process.env.ALLOW_ALNOOR_DB_RESET !== resetToken) {
    throw new Error("REFUSED: ALLOW_ALNOOR_DB_RESET guard is missing");
  }
  if (process.env.EXPECTED_DATABASE_NAME && process.env.EXPECTED_DATABASE_NAME !== target.database) {
    throw new Error("REFUSED: EXPECTED_DATABASE_NAME does not match the target");
  }
  if (target.classification === "REMOTE" && process.env.ALLOW_ALNOOR_REMOTE_RESET !== remoteToken) {
    throw new Error("REFUSED: remote reset guard is missing");
  }
}
