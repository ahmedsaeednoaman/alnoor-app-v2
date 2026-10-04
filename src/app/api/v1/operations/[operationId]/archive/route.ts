import { operationArchiveRoute } from "@/lib/operations/archive-route";
export async function POST(request: Request, { params }: { params: Promise<{ operationId: string }> }) {
  return operationArchiveRoute(request, params, true);
}
