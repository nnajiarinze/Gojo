import { query, queryOne } from '../config/database.js';
import { Organization, OrganizationMemberRole } from '../types/domain.js';

export const DEFAULT_ORGANIZATION_ID = '11111111-1111-1111-1111-111111111111';

function rowToOrganization(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    orgNumber: row.org_number,
    address: row.address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureDefaultOrganizationForUser(userId: string): Promise<string> {
  await query(
    `INSERT INTO organizations (id, name, slug, org_number, address)
     VALUES ($1, 'Gojo Restaurant', 'gojo-restaurant', '559000-0000', 'Stockholm, Sverige')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       slug = EXCLUDED.slug,
       org_number = EXCLUDED.org_number,
       address = EXCLUDED.address`,
    [DEFAULT_ORGANIZATION_ID]
  );

  await query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [DEFAULT_ORGANIZATION_ID, userId]
  );

  return DEFAULT_ORGANIZATION_ID;
}

export async function getDefaultOrganizationIdForUser(userId: string): Promise<string> {
  const row = await queryOne<{ organization_id: string }>(
    `SELECT organization_id
     FROM organization_members
     WHERE user_id = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [userId]
  );

  return row?.organization_id ?? ensureDefaultOrganizationForUser(userId);
}

export async function listOrganizations(): Promise<Organization[]> {
  const rows = await query<any>(
    `SELECT * FROM organizations ORDER BY name ASC`
  );
  return rows.map(rowToOrganization);
}

export async function listOrganizationsForUser(userId: string): Promise<Array<Organization & { role: OrganizationMemberRole }>> {
  const rows = await query<any>(
    `SELECT o.*, om.role
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.user_id = $1
     ORDER BY o.name ASC`,
    [userId]
  );

  return rows.map((row) => ({ ...rowToOrganization(row), role: row.role }));
}

export async function userBelongsToOrganization(userId: string, organizationId: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM organization_members
       WHERE user_id = $1 AND organization_id = $2
     ) AS exists`,
    [userId, organizationId]
  );
  return Boolean(row?.exists);
}
