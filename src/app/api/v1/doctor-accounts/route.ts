import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { listDoctorAccounts } from "@/lib/doctor-accounts";
import { operationError, requestId } from "@/lib/operations/api";

export async function GET(request: Request) {
  const id = requestId();
  try {
    await requirePermission("doctor_accounts.view");
    const query = new URL(request.url).searchParams;
    return NextResponse.json({ doctors: await listDoctorAccounts(query.get("search") ?? "", query.get("from") ?? undefined, query.get("to") ?? undefined) });
  } catch (error) { return operationError(error, id); }
}
