import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { getOperationPrintProjection } from "@/lib/printing/projection";
import { PrintDocument } from "@/components/printing/print-document";

export default async function Page({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");
  if (!auth.user.permissions.includes("printing.use")) redirect("/");
  const projection = await getOperationPrintProjection(
    (await params).operationId,
    auth.user,
  );
  return <PrintDocument projection={projection} />;
}
