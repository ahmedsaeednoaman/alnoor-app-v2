import { handleCatalogLifecycle } from "@/lib/catalogs/lifecycle-route";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  return handleCatalogLifecycle(params, false);
}

