/** Data access for the verification domain. */
import { query, queryOne, queryMany } from '../../db/pool.js';

const SUBMISSION = `
  s.id, s.provider_id, s.agency_id, s.status, s.full_legal_name, s.date_of_birth,
  s.id_proof_type, s.id_proof_last4, s.address_line, s.city, s.state, s.pincode,
  s.auto_check_status, s.submitted_at, s.reviewed_at, s.reviewed_by,
  s.review_notes, s.rejection_reason, s.expires_at, s.created_at
`;

export function findById(id) {
  return queryOne(`SELECT ${SUBMISSION} FROM kyc_submissions s WHERE s.id = $1`, [id]);
}

/** The submission currently awaiting a decision, if any. */
export function findOpenForProvider(providerId) {
  return queryOne(
    `SELECT ${SUBMISSION} FROM kyc_submissions s
      WHERE s.provider_id = $1 AND s.status IN ('pending','info_requested')
      ORDER BY s.submitted_at DESC LIMIT 1`,
    [providerId],
  );
}

export function findLatestForProvider(providerId) {
  return queryOne(
    `SELECT ${SUBMISSION} FROM kyc_submissions s
      WHERE s.provider_id = $1
      ORDER BY s.submitted_at DESC LIMIT 1`,
    [providerId],
  );
}

/** The agency equivalent of findOpenForProvider. */
export function findOpenForAgency(agencyId) {
  return queryOne(
    `SELECT ${SUBMISSION} FROM kyc_submissions s
      WHERE s.agency_id = $1 AND s.status IN ('pending','info_requested')
      ORDER BY s.submitted_at DESC LIMIT 1`,
    [agencyId],
  );
}

export function findLatestForAgency(agencyId) {
  return queryOne(
    `SELECT ${SUBMISSION} FROM kyc_submissions s
      WHERE s.agency_id = $1
      ORDER BY s.submitted_at DESC LIMIT 1`,
    [agencyId],
  );
}

export function createForAgency(tx, agencyId, d) {
  return tx.one(
    `INSERT INTO kyc_submissions
       (agency_id, full_legal_name, date_of_birth, id_proof_type, id_proof_last4,
        address_line, city, state, pincode, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
     RETURNING ${SUBMISSION.replaceAll('s.', '')}`,
    [agencyId, d.fullLegalName, d.dateOfBirth, d.idProofType, d.idProofLast4,
     d.addressLine, d.city, d.state, d.pincode],
  );
}

/**
 * Sets the agency's own status and pushes it onto the people it employs.
 *
 * Providers with a submission of their own in flight are skipped: their
 * evidence is being reviewed individually and must not be overwritten by an
 * inherited answer.
 */
export async function setAgencyVerification(tx, agencyId, { status, adminId = null, cascade = true }) {
  const agency = await tx.one(
    `UPDATE agencies
        SET verification_status = $2::verification_status,
            verified_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE verified_at END,
            verified_by = CASE WHEN $2 = 'approved' THEN $3 ELSE verified_by END
      WHERE id = $1
      RETURNING id, user_id, name, verification_status`,
    [agencyId, status, adminId],
  );

  if (!cascade) return { ...agency, cascaded: 0 };

  /**
   * Approval is never inherited.
   *
   * Everyone who enters a customer's home is verified on their own Aadhaar and
   * their own photograph, whether they came through an agency or on their own.
   * An agency vouching for someone is not the platform having checked them,
   * and "the agency said so" is no answer to a customer asking who turned up.
   *
   * A downgrade still cascades. If an agency is suspended or rejected, the
   * people working under it stop taking bookings with it - that direction
   * removes trust rather than granting it, and the moment it is withdrawn is
   * exactly when it has to take effect everywhere.
   */
  if (status === 'approved') return { ...agency, cascaded: 0 };

  /**
   * Skips anyone with a submission of their own under review.
   *
   * Keyed on whether that provider actually filed something, not on their
   * status column. Status alone cannot tell "pending because they submitted"
   * from "pending because their employer did" - and conflating the two means
   * approving the agency silently skips the very people it was meant to
   * approve.
   */
  const cascaded = await tx.query(
    `UPDATE provider_profiles p
        SET verification_status = $2::verification_status,
            verified_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE verified_at END,
            verified_by = CASE WHEN $2 = 'approved' THEN $3 ELSE verified_by END,
            is_accepting_bookings = CASE WHEN $2 = 'approved' THEN p.is_accepting_bookings ELSE FALSE END
      WHERE p.agency_id = $1
        AND p.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM kyc_submissions ks
           WHERE ks.provider_id = p.id
             AND ks.status IN ('pending', 'info_requested')
        )
      RETURNING p.id`,
    [agencyId, status, adminId],
  );

  return { ...agency, cascaded: cascaded.rowCount };
}

export function create(tx, providerId, d) {
  return tx.one(
    `INSERT INTO kyc_submissions
       (provider_id, full_legal_name, date_of_birth, id_proof_type, id_proof_last4,
        address_line, city, state, pincode, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
     RETURNING ${SUBMISSION.replaceAll('s.', '')}`,
    [providerId, d.fullLegalName, d.dateOfBirth, d.idProofType, d.idProofLast4,
     d.addressLine, d.city, d.state, d.pincode],
  );
}

export function update(submissionId, d) {
  return queryOne(
    `UPDATE kyc_submissions SET
       full_legal_name = COALESCE($2, full_legal_name),
       date_of_birth = COALESCE($3, date_of_birth),
       id_proof_type = COALESCE($4, id_proof_type),
       id_proof_last4 = COALESCE($5, id_proof_last4),
       address_line = COALESCE($6, address_line),
       city = COALESCE($7, city),
       state = COALESCE($8, state),
       pincode = COALESCE($9, pincode),
       status = COALESCE($10, status)
     WHERE id = $1
     RETURNING ${SUBMISSION.replaceAll('s.', '')}`,
    [submissionId, d.fullLegalName ?? null, d.dateOfBirth ?? null, d.idProofType ?? null,
     d.idProofLast4 ?? null, d.addressLine ?? null, d.city ?? null, d.state ?? null,
     d.pincode ?? null, d.status ?? null],
  );
}

export function decide(tx, submissionId, { status, adminId, notes, rejectionReason, expiresAt }) {
  return tx.one(
    `UPDATE kyc_submissions
        SET status = $2, reviewed_by = $3, reviewed_at = NOW(),
            review_notes = $4, rejection_reason = $5,
            expires_at = COALESCE($6, expires_at)
      WHERE id = $1
      RETURNING ${SUBMISSION.replaceAll('s.', '')}`,
    [submissionId, status, adminId, notes ?? null, rejectionReason ?? null, expiresAt ?? null],
  );
}

export function recordReviewEvent(tx, { submissionId, adminId, fromStatus, toStatus, notes }) {
  return tx.query(
    `INSERT INTO kyc_review_events (submission_id, admin_id, from_status, to_status, notes)
     VALUES ($1,$2,$3,$4,$5)`,
    [submissionId, adminId, fromStatus, toStatus, notes ?? null],
  );
}

export function reviewHistory(submissionId) {
  return queryMany(
    `SELECT e.id, e.from_status, e.to_status, e.notes, e.created_at, u.full_name AS admin_name
       FROM kyc_review_events e
       LEFT JOIN users u ON u.id = e.admin_id
      WHERE e.submission_id = $1
      ORDER BY e.created_at`,
    [submissionId],
  );
}

// ---------- documents ----------

export function addDocument(submissionId, d) {
  return queryOne(
    `INSERT INTO kyc_documents
       (submission_id, doc_type, storage_key, original_name, mime_type, size_bytes, checksum)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, doc_type, storage_key, original_name, mime_type, size_bytes, uploaded_at`,
    [submissionId, d.docType, d.storageKey, d.originalName, d.mimeType, d.sizeBytes, d.checksum],
  );
}

export function listDocuments(submissionId) {
  return queryMany(
    `SELECT id, doc_type, storage_key, original_name, mime_type, size_bytes, uploaded_at
       FROM kyc_documents WHERE submission_id = $1 ORDER BY uploaded_at`,
    [submissionId],
  );
}

export function findDocument(documentId) {
  return queryOne(
    `SELECT d.id, d.submission_id, d.storage_key, d.mime_type, d.original_name, s.provider_id
       FROM kyc_documents d JOIN kyc_submissions s ON s.id = d.submission_id
      WHERE d.id = $1`,
    [documentId],
  );
}

export function removeDocument(submissionId, documentId) {
  return queryOne(
    'DELETE FROM kyc_documents WHERE id = $2 AND submission_id = $1 RETURNING storage_key',
    [submissionId, documentId],
  );
}

// ---------- provider verification status ----------

export function setProviderVerification(tx, providerId, { status, adminId = null, goOffline = false }) {
  return tx.one(
    `UPDATE provider_profiles
        SET verification_status = $2,
            verified_at = CASE WHEN $2 = 'approved'::verification_status THEN NOW() ELSE verified_at END,
            verified_by = CASE WHEN $2 = 'approved'::verification_status THEN $3 ELSE verified_by END,
            is_accepting_bookings = CASE WHEN $4 THEN FALSE ELSE is_accepting_bookings END
      WHERE id = $1
      RETURNING id, user_id, verification_status, is_accepting_bookings`,
    [providerId, status, adminId, goOffline],
  );
}

export default {
  findById, findOpenForProvider, findLatestForProvider, create, update, decide,
  recordReviewEvent, reviewHistory, addDocument, listDocuments, findDocument,
  removeDocument, setProviderVerification,
  findOpenForAgency, findLatestForAgency, createForAgency, setAgencyVerification,
};

// ---------- admin review queue ----------

/**
 * The queue an admin works through. Oldest submission first, because a
 * provider waiting on approval is a provider earning nothing.
 */
export async function queue({ status, search, limit, offset }) {
  const where = [];
  const params = [];

  if (status) {
    params.push(status);
    where.push(`s.status = $${params.length}`);
  } else {
    where.push(`s.status IN ('pending','info_requested')`);
  }

  if (search) {
    params.push('%' + search + '%');
    where.push(
      `(s.full_legal_name ILIKE $${params.length} OR u.full_name ILIKE $${params.length}
        OR u.phone ILIKE $${params.length} OR u.email ILIKE $${params.length})`,
    );
  }

  const clause = 'WHERE ' + where.join(' AND ');

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total
       FROM kyc_submissions s
       LEFT JOIN provider_profiles p ON p.id = s.provider_id
       LEFT JOIN agencies a ON a.id = s.agency_id
       JOIN users u ON u.id = COALESCE(p.user_id, a.user_id)
       ${clause}`,
    params,
  );

  params.push(limit, offset);

  const items = await queryMany(
    `SELECT s.id, s.provider_id, s.agency_id, s.status, s.full_legal_name, s.id_proof_type,
            s.city, s.state, s.submitted_at, s.reviewed_at,
            CASE WHEN s.agency_id IS NOT NULL THEN 'agency' ELSE 'provider' END AS subject_type,
            u.full_name, u.email, u.phone, u.avatar_url,
            COALESCE(p.business_name, a.name) AS business_name, p.experience_years,
            (SELECT COUNT(*)::int FROM kyc_documents d WHERE d.submission_id = s.id) AS document_count,
            (SELECT COUNT(*)::int FROM provider_categories pc WHERE pc.provider_id = p.id) AS service_count,
            EXISTS (
              SELECT 1 FROM provider_categories pc
              JOIN service_categories c ON c.id = pc.category_id
              WHERE pc.provider_id = p.id AND c.requires_certification
            ) AS needs_certification
       FROM kyc_submissions s
       LEFT JOIN provider_profiles p ON p.id = s.provider_id
       LEFT JOIN agencies a ON a.id = s.agency_id
       JOIN users u ON u.id = COALESCE(p.user_id, a.user_id)
       ${clause}
       ORDER BY s.submitted_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: countRows[0].total };
}

/** Counts for the admin dashboard badge. */
export function queueCounts() {
  return queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'info_requested')::int AS info_requested,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (
         WHERE status = 'pending' AND submitted_at < NOW() - INTERVAL '48 hours'
       )::int AS waiting_over_48h
     FROM kyc_submissions`,
  );
}

export function findSubmissionDetail(id) {
  return queryOne(
    `SELECT s.*, u.full_name, u.email, u.phone, u.avatar_url, u.created_at AS account_created_at,
            CASE WHEN s.agency_id IS NOT NULL THEN 'agency' ELSE 'provider' END AS subject_type,
            COALESCE(p.business_name, a.name) AS business_name,
            p.headline, p.experience_years, p.skills, p.languages,
            COALESCE(p.verification_status, a.verification_status) AS provider_status,
            p.is_accepting_bookings,
            -- How many people inherit this decision, so an admin approving an
            -- agency can see the blast radius before they click.
            (SELECT COUNT(*)::int FROM provider_profiles ap
              WHERE ap.agency_id = s.agency_id AND ap.deleted_at IS NULL) AS agency_provider_count
       FROM kyc_submissions s
       LEFT JOIN provider_profiles p ON p.id = s.provider_id
       LEFT JOIN agencies a ON a.id = s.agency_id
       JOIN users u ON u.id = COALESCE(p.user_id, a.user_id)
      WHERE s.id = $1`,
    [id],
  );
}
