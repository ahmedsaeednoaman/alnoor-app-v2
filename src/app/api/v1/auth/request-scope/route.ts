import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { authenticatedRequestScope } from "@/lib/auth/request-scope";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET() {
  try {
    const auth = await getCurrentSession();
    if (!auth) return NextResponse.json({ scope: null }, { status: 401, headers });
    return NextResponse.json(authenticatedRequestScope(auth), { headers });
  } catch {
    // Verification failure must not reactivate an old scope or reveal auth internals.
    return NextResponse.json({ scope: null }, { status: 503, headers });
  }
}
