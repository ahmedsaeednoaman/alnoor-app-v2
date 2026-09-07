import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { listLithotripsyFinancialSources } from "@/lib/accounting/lithotripsy-source-picker";
import { operationError, requestId } from "@/lib/operations/api";

export const runtime = "nodejs";

export async function GET() {
  const id = requestId();
  try {
    await requirePermission("accounting.lithotripsy.pricing.manage");
    const sources = await listLithotripsyFinancialSources();
    return NextResponse.json({
      items: [
        ...sources.map((source) => ({ id: source.id, name: source.name })),
        { id: "fixed", name: "بند مالي ثابت" },
        { id: "manual", name: "بند مخصص / يدوي" },
      ],
      sources,
    });
  } catch (error) {
    return operationError(error, id);
  }
}
