import "server-only";

import { postgresClient } from "@/db/client";
import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { listDoctorAccounts, type DoctorAccountSummary } from "@/lib/doctor-accounts";

type HomeAuthUser = {
  id: string;
  displayName: string;
  role: { code: string; name: string };
  permissions: string[];
};

export type HomeOperation = {
  id: string;
  type: "lithotripsy" | "endoscopy" | "contract";
  date: string;
  time: string;
  caseName: string;
  doctorName: string | null;
  hospitalName: string | null;
  status: string;
  canEdit: boolean;
};

export type HomeReviewItem = Pick<HomeOperation, "id" | "type" | "date" | "time" | "caseName" | "doctorName" | "hospitalName">;

export type HomeDoctorAccount = Pick<DoctorAccountSummary, "doctorId" | "doctorName" | "balance" | "lastMovementAt">;

export type HomeData = {
  identity: { displayName: string; role: { code: string; label: string } };
  capabilities: {
    canAddWork: boolean;
    canViewOperations: boolean;
    canReviewWork: boolean;
    canViewDoctorAccounts: boolean;
    canViewReports: boolean;
    canUsePrinting: boolean;
    canViewSettings: boolean;
  };
  today: { operationCount: number } | null;
  recentOperations: HomeOperation[] | null;
  review: { awaitingCount: number; awaitingOperations: HomeReviewItem[] } | null;
  doctorAccounts: { accounts: HomeDoctorAccount[] } | null;
};

type OperationRow = {
  id: string;
  type: HomeOperation["type"];
  operationDate: string;
  operationTime: string;
  caseName: string;
  doctorName: string | null;
  hospitalName: string | null;
  status: string;
  employeeEditWindow: boolean;
};

type ReviewRow = Omit<OperationRow, "status" | "employeeEditWindow">;

export type HomeReadDependencies = {
  countToday: (user: HomeAuthUser) => Promise<number>;
  recentOperations: (user: HomeAuthUser, limit: number) => Promise<OperationRow[]>;
  awaitingReview: (limit: number) => Promise<{ count: number; operations: ReviewRow[] }>;
  doctorAccounts: () => Promise<DoctorAccountSummary[]>;
};

const has = (user: HomeAuthUser, permission: string) => user.permissions.includes(permission);
const isEmployee = (user: HomeAuthUser) => user.role.code === "employee";
const scalarCount = (value: unknown) => Number(value ?? 0);

const defaultDependencies: HomeReadDependencies = {
  async countToday(user) {
    const [row] = await postgresClient.unsafe<Array<{ count: string }>>(
      `select count(*)::text count
         from operations o
        where o.status <> 'cancelled'
          and o.operation_date = current_date
          and ($1::boolean = false or o.created_by_user_id = $2::uuid)`,
      [isEmployee(user), user.id],
    );
    return scalarCount(row?.count);
  },

  async recentOperations(user, limit) {
    return postgresClient.unsafe<OperationRow[]>(
      `select o.id,o.type,o.operation_date "operationDate",o.operation_time "operationTime",
              o.case_name "caseName",d.name "doctorName",h.name "hospitalName",o.status,
              (o.created_by_user_id=$2::uuid and o.created_at >= now()-interval '48 hours') "employeeEditWindow"
         from operations o
         left join doctors d on d.id=o.doctor_id
         left join hospitals h on h.id=o.hospital_id
        where o.status <> 'cancelled'
          and ($1::boolean = false or (o.created_by_user_id=$2::uuid and o.operation_date >= current_date-6))
        order by o.operation_date desc,o.daily_sequence desc
        limit $3`,
      [isEmployee(user), user.id, limit],
    );
  },

  async awaitingReview(limit) {
    const [countRows, operations] = await Promise.all([
      postgresClient.unsafe<Array<{ count: string }>>(
        `select count(*)::text count
           from operations o
           left join operation_financial_reviews fr on fr.operation_id=o.id
          where o.status='recorded'
            and coalesce(fr.status,'awaiting_review')='awaiting_review'::financial_review_status`,
      ),
      postgresClient.unsafe<ReviewRow[]>(
        `select o.id,o.type,o.operation_date "operationDate",o.operation_time "operationTime",
                o.case_name "caseName",d.name "doctorName",h.name "hospitalName"
           from operations o
           left join operation_financial_reviews fr on fr.operation_id=o.id
           left join doctors d on d.id=o.doctor_id
           left join hospitals h on h.id=o.hospital_id
          where o.status='recorded'
            and coalesce(fr.status,'awaiting_review')='awaiting_review'::financial_review_status
          order by o.operation_date desc,o.daily_sequence desc
          limit $1`,
        [limit],
      ),
    ]);
    return { count: scalarCount(countRows[0]?.count), operations };
  },

  doctorAccounts: () => listDoctorAccounts(),
};

export async function buildHomeData(
  user: HomeAuthUser,
  dependencies: HomeReadDependencies = defaultDependencies,
): Promise<HomeData> {
  const capabilities = {
    canAddWork: has(user, "operations.create"),
    canViewOperations: has(user, "operations.view"),
    canReviewWork: has(user, "accounting.review"),
    canViewDoctorAccounts: has(user, "doctor_accounts.view"),
    canViewReports: has(user, "reports.view"),
    canUsePrinting: has(user, "printing.use"),
    canViewSettings: has(user, "users.view") || has(user, "settings.view"),
  };

  const [operationData, reviewData, doctorData] = await Promise.all([
    capabilities.canViewOperations
      ? Promise.all([dependencies.countToday(user), dependencies.recentOperations(user, 5)])
      : Promise.resolve(null),
    capabilities.canReviewWork ? dependencies.awaitingReview(5) : Promise.resolve(null),
    capabilities.canViewDoctorAccounts ? dependencies.doctorAccounts() : Promise.resolve(null),
  ]);

  const canEditOperations = has(user, "operations.edit");
  return {
    identity: { displayName: user.displayName, role: { code: user.role.code, label: user.role.name } },
    capabilities,
    today: operationData ? { operationCount: operationData[0] } : null,
    recentOperations: operationData
      ? operationData[1].map((operation) => ({
          id: operation.id,
          type: operation.type,
          date: operation.operationDate,
          time: operation.operationTime,
          caseName: operation.caseName,
          doctorName: operation.doctorName,
          hospitalName: operation.hospitalName,
          status: operation.status,
          canEdit: canEditOperations && (!isEmployee(user) || operation.employeeEditWindow),
        }))
      : null,
    review: reviewData
      ? {
          awaitingCount: reviewData.count,
          awaitingOperations: reviewData.operations.map((operation) => ({
            id: operation.id,
            type: operation.type,
            date: operation.operationDate,
            time: operation.operationTime,
            caseName: operation.caseName,
            doctorName: operation.doctorName,
            hospitalName: operation.hospitalName,
          })),
        }
      : null,
    doctorAccounts: doctorData
      ? {
          accounts: doctorData.slice(0, 5).map(({ doctorId, doctorName, balance, lastMovementAt }) => ({
            doctorId,
            doctorName,
            balance,
            lastMovementAt,
          })),
        }
      : null,
  };
}

export async function getHomeData(): Promise<HomeData> {
  const auth = await requireAuthenticatedUser();
  return buildHomeData(auth.user);
}
