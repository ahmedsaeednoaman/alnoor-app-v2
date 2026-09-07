import { postgresClient } from "@/db/client";
import { normalizeCatalogName } from "@/lib/catalogs/normalize-name";
import { normalizeProcedureSet } from "@/lib/accounting/lithotripsy-profiles";

type Executor = Pick<typeof postgresClient, "unsafe">;
type SeedLine = {
  stableKey: string;
  lineType: "linked_role" | "fixed_cost";
  label: string;
  amount: number;
  sourceType?: string;
};
type SeedPlan = {
  sessionNumber: 1 | 2;
  name: string;
  procedureName: string;
  lines: SeedLine[];
  requiresOwnerConfirmation?: boolean;
};

export const LITHOTRIPSY_REAL_PRICING_PLAN: SeedPlan[] = [
  {
    sessionNumber: 1,
    name: "تفتيت فقط",
    procedureName: "تفتيت",
    lines: [
      { stableKey: "paper_session_operating_charge", lineType: "fixed_cost", label: "مصاريف تشغيل الجلسة", amount: 400 },
      { stableKey: "paper_technician_default", lineType: "linked_role", label: "الفني — افتراضي", amount: 450, sourceType: "technician" },
      { stableKey: "paper_anesthesiologist_default", lineType: "linked_role", label: "طبيب التخدير — افتراضي", amount: 400, sourceType: "anesthesiologist" },
      { stableKey: "paper_hospital_account", lineType: "fixed_cost", label: "حساب المستشفى", amount: 800 },
      { stableKey: "paper_nursing_workers", lineType: "fixed_cost", label: "تمريض وعمال", amount: 250 },
      { stableKey: "paper_lithotripsy_account", lineType: "fixed_cost", label: "حساب التفتيت", amount: 900 },
    ],
  },
  {
    sessionNumber: 1,
    name: "تفتيت + تركيب",
    procedureName: "تفتيت و تركيب",
    lines: [
      { stableKey: "paper_session_operating_charge", lineType: "fixed_cost", label: "مصاريف تشغيل الجلسة", amount: 400 },
      { stableKey: "paper_technician_default", lineType: "linked_role", label: "الفني — افتراضي", amount: 450, sourceType: "technician" },
      { stableKey: "paper_anesthesiologist_default", lineType: "linked_role", label: "طبيب التخدير — افتراضي", amount: 400, sourceType: "anesthesiologist" },
      { stableKey: "paper_hospital_account", lineType: "fixed_cost", label: "حساب المستشفى", amount: 1100 },
      { stableKey: "paper_equipment_default", lineType: "linked_role", label: "الأجهزة / المناظير — افتراضي", amount: 500, sourceType: "equipment" },
      { stableKey: "paper_stent_default", lineType: "linked_role", label: "الدعامات — افتراضي", amount: 750, sourceType: "stent" },
      { stableKey: "paper_nursing_workers", lineType: "fixed_cost", label: "تمريض وعمال", amount: 250 },
      { stableKey: "paper_sterilization", lineType: "fixed_cost", label: "تعقيم", amount: 50 },
      { stableKey: "paper_lithotripsy_account", lineType: "fixed_cost", label: "حساب التفتيت", amount: 850 },
    ],
  },
  { sessionNumber: 2, name: "تفتيت فقط — يحتاج اعتماد الأسعار", procedureName: "تفتيت", lines: [], requiresOwnerConfirmation: true },
  { sessionNumber: 2, name: "تفتيت + تركيب — يحتاج اعتماد الأسعار", procedureName: "تفتيت و تركيب", lines: [], requiresOwnerConfirmation: true },
];

export const planTotal = (plan: SeedPlan) => plan.lines.reduce((total, line) => total + line.amount, 0);

export type LithotripsyRealPricingSeedResult = {
  sessions: Array<{ sessionNumber: number; id: string; status: "reused" | "created" }>;
  profiles: Array<{ sessionNumber: number; name: string; id: string; status: "created" | "preserved"; total: number; requiresOwnerConfirmation: boolean }>;
};

export async function seedLithotripsyRealPricing(db: Executor): Promise<LithotripsyRealPricingSeedResult> {
  const [actor] = await db.unsafe<Array<{ id: string }>>(`select u.id from users u join roles r on r.id=u.base_role_id where u.username='tests' and u.status='active' and u.archived_at is null and r.code='owner' limit 1`);
  if (!actor) throw new Error("The active disposable Owner 'tests' is required to seed Lithotripsy pricing safely.");

  const sessions: LithotripsyRealPricingSeedResult["sessions"] = [];
  for (const sessionNumber of [1, 2] as const) {
    const existing = await db.unsafe<Array<{ id: string }>>("select id from lithotripsy_sessions where session_number=$1 limit 1", [sessionNumber]);
    if (existing[0]) {
      sessions.push({ sessionNumber, id: existing[0].id, status: "reused" });
      continue;
    }
    const [created] = await db.unsafe<Array<{ id: string }>>(`insert into lithotripsy_sessions(session_number,name,sort_order,active,created_by_user_id,updated_by_user_id) values($1,$2,$3,true,$4::uuid,$4::uuid) returning id`, [sessionNumber, sessionNumber === 1 ? "الجلسة الأولى" : "الجلسة الثانية", sessionNumber - 1, actor.id]);
    sessions.push({ sessionNumber, id: created.id, status: "created" });
  }

  const profiles: LithotripsyRealPricingSeedResult["profiles"] = [];
  for (const plan of LITHOTRIPSY_REAL_PRICING_PLAN) {
    const session = sessions.find((item) => item.sessionNumber === plan.sessionNumber);
    const [procedure] = await db.unsafe<Array<{ id: string }>>("select id from procedures where normalized_name=$1 and archived_at is null and is_active=true limit 1", [normalizeCatalogName(plan.procedureName)]);
    if (!session || !procedure) throw new Error(`Missing canonical procedure '${plan.procedureName}' or Session ${plan.sessionNumber}; no catalog record was fabricated.`);
    const procedureSetKey = normalizeProcedureSet([procedure.id]);
    const existing = await db.unsafe<Array<{ id: string }>>("select id from lithotripsy_pricing_profiles where session_id=$1::uuid and procedure_set_key=$2 and name not like 'TEST-%' order by created_at limit 1", [session.id, procedureSetKey]);
    if (existing[0]) {
      profiles.push({ sessionNumber: plan.sessionNumber, name: plan.name, id: existing[0].id, status: "preserved", total: planTotal(plan), requiresOwnerConfirmation: Boolean(plan.requiresOwnerConfirmation) });
      continue;
    }
    const [profile] = await db.unsafe<Array<{ id: string }>>(`insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,session_id,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$5::uuid,false,true,1,(select coalesce(max(sort_order),-1)+1 from lithotripsy_pricing_profiles),$6::uuid,$6::uuid) returning id`, [plan.name, normalizeCatalogName(plan.name), procedureSetKey, plan.sessionNumber, session.id, actor.id]);
    await db.unsafe("insert into lithotripsy_pricing_profile_procedures(profile_id,procedure_id,sort_order) values($1::uuid,$2::uuid,0)", [profile.id, procedure.id]);
    for (const [sortOrder, line] of plan.lines.entries()) {
      await db.unsafe(`insert into lithotripsy_pricing_profile_lines(profile_id,stable_key,line_type,label,default_amount,effect,source_type,source_reference_id,session_value,sort_order,active,created_by_user_id,updated_by_user_id)
        values($1::uuid,$2,$3::lithotripsy_pricing_profile_line_type,$4,$5::numeric,'subtract'::work_form_financial_effect,$6,null,null,$7,true,$8::uuid,$8::uuid)`, [profile.id, line.stableKey, line.lineType, line.label, line.amount, line.sourceType ?? null, sortOrder, actor.id]);
    }
    profiles.push({ sessionNumber: plan.sessionNumber, name: plan.name, id: profile.id, status: "created", total: planTotal(plan), requiresOwnerConfirmation: Boolean(plan.requiresOwnerConfirmation) });
  }
  return { sessions, profiles };
}
