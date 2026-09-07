import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { operationError, requestId } from "@/lib/operations/api";
import { getOperationPrintProjection } from "@/lib/printing/projection";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operationId: string }> },
) {
  const id = requestId();
  try {
    const auth = await requirePermission("printing.use");
    return NextResponse.json(
      await getOperationPrintProjection((await params).operationId, auth.user),
    );
  } catch (error) {
    return operationError(error, id);
  }
}
