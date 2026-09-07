import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { operationError, requestId } from "@/lib/operations/api";
import { createServicePricingProfile, listServicePricing, mutateServicePricing, servicePricingPermission, type ServicePricingDomain } from "@/lib/accounting/service-pricing";
import { listServicePricingCatalog, listServicePricingSources } from "@/lib/accounting/service-pricing-sources";

const domain = (value: string): ServicePricingDomain => {
  if (value !== "contract" && value !== "endoscopy") throw new Error("SERVICE_PRICING_DOMAIN_INVALID");
  return value;
};
export async function GET(request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const type = domain((await params).operationType);
    await requirePermission(servicePricingPermission(type));
    const catalog = new URL(request.url).searchParams.get("catalog");
    if (catalog) return NextResponse.json({ items: await listServicePricingCatalog(type, catalog) });
    return NextResponse.json({ profiles: await listServicePricing(type), sources: await listServicePricingSources(type) });
  } catch (error) { return operationError(error, id); }
}
export async function POST(request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const type = domain((await params).operationType), auth = await requirePermission(servicePricingPermission(type));
    return NextResponse.json({ profiles: await createServicePricingProfile(type, await request.json(), auth.user.id) }, { status: 201 });
  } catch (error) { return operationError(error, id); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const type = domain((await params).operationType), auth = await requirePermission(servicePricingPermission(type));
    return NextResponse.json({ profiles: await mutateServicePricing(type, await request.json(), auth.user.id) });
  } catch (error) { return operationError(error, id); }
}
