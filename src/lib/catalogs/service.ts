import { postgresClient } from "@/db/client";

import {
  getCatalogDefinition,
  type CatalogDefinition,
  type CatalogType,
} from "./definitions";
import { normalizeCatalogName } from "./normalize-name";

type CatalogParameter = string | number | boolean | null;
type CatalogRow = Record<string, unknown>;

export class CatalogServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CatalogServiceError";
  }
}

function quoteIdentifier(value: string) {
  if (!/^[a-z_]+$/.test(value)) {
    throw new Error("Unsafe catalog identifier.");
  }

  return `"${value}"`;
}

function toDto(row: CatalogRow, includeFinancialAmount: boolean) {
  const dto: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  const optionalColumns = {
    specialty: "specialty",
    phone: "phone",
    entityType: "entity_type",
    address: "address",
    contractEntityId: "contract_entity_id",
    category: "category",
    supportsSide: "supports_side",
    equipmentType: "equipment_type",
    fixedHospitalId: "fixed_hospital_id",
    defaultNote: "default_note",
    linkedUserId: "linked_user_id",
    defaultKind: "default_kind",
  } as const;

  for (const [property, column] of Object.entries(optionalColumns)) {
    if (column in row) {
      dto[property] = row[column];
    }
  }

  if (includeFinancialAmount && "default_amount" in row) {
    dto.defaultAmount =
      row.default_amount === null
        ? null
        : Number(row.default_amount);
  }

  return dto;
}

function tableSql(definition: CatalogDefinition) {
  return quoteIdentifier(definition.tableName);
}

async function findReference(
  tableName: "contract_entities" | "hospitals" | "users",
  id: string,
  requireAvailable: boolean,
) {
  const availability = requireAvailable
    ? " AND archived_at IS NULL AND is_active = true"
    : "";

  const rows = await postgresClient.unsafe<CatalogRow[]>(
    `SELECT id FROM ${quoteIdentifier(tableName)} WHERE id = $1::uuid${availability} LIMIT 1`,
    [id],
  );

  return rows.length > 0;
}

export async function validateCatalogReferences(
  type: CatalogType,
  data: Record<string, unknown>,
) {
  if (type === "hospitals" && typeof data.contractEntityId === "string") {
    if (!(await findReference("contract_entities", data.contractEntityId, true))) {
      throw new CatalogServiceError(
        "INVALID_CONTRACT_ENTITY",
        "جهة التعاقد المحددة غير موجودة أو غير متاحة.",
        400,
      );
    }
  }

  if (type === "equipment" && typeof data.fixedHospitalId === "string") {
    if (!(await findReference("hospitals", data.fixedHospitalId, true))) {
      throw new CatalogServiceError(
        "INVALID_FIXED_HOSPITAL",
        "المستشفى الثابت المحدد غير موجود أو غير متاح.",
        400,
      );
    }
  }

  if (type === "technicians" && typeof data.linkedUserId === "string") {
    if (!(await findReference("users", data.linkedUserId, false))) {
      throw new CatalogServiceError(
        "INVALID_LINKED_USER",
        "المستخدم المرتبط غير موجود.",
        400,
      );
    }
  }
}

function databaseValues(
  definition: CatalogDefinition,
  data: Record<string, unknown>,
  includeName: boolean,
): Record<string, CatalogParameter> {
  const values: Record<string, CatalogParameter> = {};

  if (includeName && typeof data.name === "string") {
    const name = data.name.trim().replace(/\s+/gu, " ");
    values.name = name;
    values.normalized_name = normalizeCatalogName(name);
  }

  if (typeof data.isActive === "boolean") {
    values.is_active = data.isActive;
  }

  for (const [property, column] of Object.entries(definition.columns)) {
    const value = data[property];

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      values[column] = value;
    }
  }

  return values;
}

export async function listCatalog(
  type: CatalogType,
  input: {
    search?: string;
    active?: boolean;
    archived?: boolean;
    cursor?: string;
    limit: number;
  },
  includeFinancialAmount: boolean,
) {
  const definition = getCatalogDefinition(type);

  if (!definition) {
    throw new CatalogServiceError("UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", 404);
  }

  const normalizedSearch = input.search
    ? normalizeCatalogName(input.search)
    : null;

  const rows = await postgresClient.unsafe<CatalogRow[]>(
    `SELECT *
       FROM ${tableSql(definition)}
      WHERE (($1::boolean = true AND archived_at IS NOT NULL)
          OR ($1::boolean = false AND archived_at IS NULL))
        AND ($2::boolean IS NULL OR is_active = $2::boolean)
        AND ($3::text IS NULL OR normalized_name LIKE '%' || $3::text || '%')
        AND ($4::uuid IS NULL OR id > $4::uuid)
      ORDER BY id
      LIMIT $5`,
    [
      input.archived ?? false,
      input.active ?? null,
      normalizedSearch,
      input.cursor ?? null,
      input.limit + 1,
    ],
  );

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    items: pageRows.map((row) => toDto(row, includeFinancialAmount)),
    meta: {
      count: pageRows.length,
      nextCursor: hasMore ? String(pageRows.at(-1)?.id) : null,
    },
  };
}

export async function createCatalogItem(
  type: CatalogType,
  data: Record<string, unknown>,
  createdByUserId: string,
  includeFinancialAmount: boolean,
) {
  const definition = getCatalogDefinition(type);

  if (!definition) {
    throw new CatalogServiceError("UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", 404);
  }

  await validateCatalogReferences(type, data);

  const values: Record<string, CatalogParameter> = {
    ...databaseValues(definition, data, true),
    created_by_user_id: createdByUserId,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await postgresClient.unsafe<CatalogRow[]>(
    `INSERT INTO ${tableSql(definition)} (${columns.map(quoteIdentifier).join(", ")})
     VALUES (${placeholders})
     RETURNING *`,
    columns.map((column) => values[column]),
  );

  return toDto(rows[0], includeFinancialAmount);
}

export async function getCatalogItem(type: CatalogType, id: string) {
  const definition = getCatalogDefinition(type);

  if (!definition) {
    throw new CatalogServiceError("UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", 404);
  }

  const rows = await postgresClient.unsafe<CatalogRow[]>(
    `SELECT * FROM ${tableSql(definition)} WHERE id = $1::uuid LIMIT 1`,
    [id],
  );

  return rows[0] ?? null;
}

export async function updateCatalogItem(
  type: CatalogType,
  id: string,
  data: Record<string, unknown>,
  includeFinancialAmount: boolean,
) {
  const definition = getCatalogDefinition(type);

  if (!definition) {
    throw new CatalogServiceError("UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", 404);
  }

  const existing = await getCatalogItem(type, id);

  if (!existing) {
    throw new CatalogServiceError("CATALOG_ITEM_NOT_FOUND", "العنصر غير موجود.", 404);
  }

  if (existing.archived_at) {
    throw new CatalogServiceError(
      "CATALOG_ITEM_ARCHIVED",
      "لا يمكن تعديل عنصر مؤرشف. قم باستعادته أولاً.",
      409,
    );
  }

  await validateCatalogReferences(type, data);

  if (type === "financial-items") {
    const resultingKind = data.defaultKind ?? existing.default_kind;
    const resultingAmount =
      "defaultAmount" in data ? data.defaultAmount : existing.default_amount;

    if (resultingKind === "note" && resultingAmount != null) {
      throw new CatalogServiceError(
        "NOTE_AMOUNT_NOT_ALLOWED",
        "البند النصي لا يمكن أن يحتوي على مبلغ افتراضي.",
        400,
      );
    }
  }

  const values: Record<string, CatalogParameter> = {
    ...databaseValues(definition, data, "name" in data),
    updated_at: new Date().toISOString(),
  };
  const columns = Object.keys(values);
  const assignments = columns
    .map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`)
    .join(", ");
  const rows = await postgresClient.unsafe<CatalogRow[]>(
    `UPDATE ${tableSql(definition)}
        SET ${assignments}
      WHERE id = $${columns.length + 1}::uuid
      RETURNING *`,
    [...columns.map((column) => values[column]), id],
  );

  return toDto(rows[0], includeFinancialAmount);
}

export async function setCatalogArchived(
  type: CatalogType,
  id: string,
  archived: boolean,
  includeFinancialAmount: boolean,
) {
  const definition = getCatalogDefinition(type);

  if (!definition) {
    throw new CatalogServiceError("UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", 404);
  }

  const existing = await getCatalogItem(type, id);

  if (!existing) {
    throw new CatalogServiceError("CATALOG_ITEM_NOT_FOUND", "العنصر غير موجود.", 404);
  }

  if (Boolean(existing.archived_at) === archived) {
    return toDto(existing, includeFinancialAmount);
  }

  const rows = await postgresClient.unsafe<CatalogRow[]>(
    `UPDATE ${tableSql(definition)}
        SET archived_at = $1::timestamptz,
            updated_at = $2::timestamptz
      WHERE id = $3::uuid
      RETURNING *`,
    [archived ? new Date().toISOString() : null, new Date().toISOString(), id],
  );

  return toDto(rows[0], includeFinancialAmount);
}

export function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

