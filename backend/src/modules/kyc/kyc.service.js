/**
 * Verification and KYC business logic.
 *
 * This module owns the single field that decides whether a provider is
 * commercially live. Discovery, Booking and Payouts all read it, so every
 * transition through here is recorded and every decision is attributable.
 */
import crypto from 'node:crypto';
import { withTransaction } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { VERIFICATION_STATUS } from '../../config/constants.js';
import * as storage from '../../storage/storage.service.js';
import { notifyAsync } from '../../services/notification.service.js';
import * as repo from './kyc.repository.js';

const OPEN_STATES = [VERIFICATION_STATUS.PENDING, VERIFICATION_STATUS.INFO_REQUESTED];

/**
 * Documents every submission must carry before it can be reviewed.
 *
 * A photograph is required, not optional. The customer sees who is coming and
 * the admin can check the face against the identity document - a verification
 * that never looked at the person is a verification of paperwork only.
 *
 * `identity` is where the Aadhaar goes; the submission form records which kind
 * of id it is and its last four digits alongside.
 *
 * Address proof is deliberately not here. An Aadhaar carries the holder's
 * address, so demanding a second document proving the same thing is friction
 * that turns providers away at the one step they cannot skip. It can still be
 * uploaded, and an admin can still ask for one through request-info when a
 * particular submission needs it.
 */
const REQUIRED_DOCS = ['identity', 'photo'];

/**
 * How each document is named in a sentence.
 *
 * Joining the raw keys produced "has not uploaded address and photo proof",
 * which is not English and leaves the admin guessing what a "photo proof" is.
 */
const DOC_LABELS = {
  identity: 'an identity proof',
  address: 'an address proof',
  photo: 'a photograph',
  trade_certificate: 'a trade certificate',
  other: 'a supporting document',
};

const listDocs = (types) =>
  types
    .map((t) => DOC_LABELS[t] ?? t)
    .reduce((text, item, i, all) =>
      i === 0 ? item : i === all.length - 1 ? text + ' and ' + item : text + ', ' + item,
    '');

function presentSubmission(s, documents = []) {
  return {
    id: s.id,
    providerId: s.provider_id,
    status: s.status,
    fullLegalName: s.full_legal_name,
    dateOfBirth: s.date_of_birth,
    idProofType: s.id_proof_type,
    idProofLast4: s.id_proof_last4,
    address: {
      line: s.address_line,
      city: s.city,
      state: s.state,
      pincode: s.pincode,
    },
    submittedAt: s.submitted_at,
    reviewedAt: s.reviewed_at,
    reviewNotes: s.review_notes,
    rejectionReason: s.rejection_reason,
    expiresAt: s.expires_at,
    documents: documents.map(presentDocument),
  };
}

/**
 * Documents are exposed as short-lived signed URLs, never as raw storage keys,
 * so an identity document cannot be fetched from a copied path later.
 */
function presentDocument(d) {
  return {
    id: d.id,
    docType: d.doc_type,
    originalName: d.original_name,
    mimeType: d.mime_type,
    sizeBytes: Number(d.size_bytes),
    uploadedAt: d.uploaded_at,
    // The type and name come from the row, not from the storage key: the
    // extension is whatever the uploader called the file, the mime type is
    // what the bytes were verified to be.
    url: storage.signedUrl(d.storage_key, {
      contentType: d.mime_type,
      filename: d.original_name,
    }),
    urlExpiresInSeconds: storage.DEFAULT_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------- provider side

export async function getMySubmission(providerId) {
  const submission = await repo.findLatestForProvider(providerId);
  if (!submission) {
    return {
      status: VERIFICATION_STATUS.UNSUBMITTED,
      submission: null,
      requiredDocuments: REQUIRED_DOCS,
      canSubmit: true,
    };
  }

  const documents = await repo.listDocuments(submission.id);
  const uploaded = new Set(documents.map((d) => d.doc_type));

  return {
    status: submission.status,
    submission: presentSubmission(submission, documents),
    requiredDocuments: REQUIRED_DOCS,
    missingDocuments: REQUIRED_DOCS.filter((d) => !uploaded.has(d)),
    canSubmit: [VERIFICATION_STATUS.REJECTED, VERIFICATION_STATUS.INFO_REQUESTED].includes(submission.status),
    history: await repo.reviewHistory(submission.id),
  };
}

/**
 * Creates or updates the provider's submission. An approved provider cannot
 * quietly re-submit different details - that would let someone verified as one
 * person start operating as another.
 */
export async function submit(providerId, payload) {
  const latest = await repo.findLatestForProvider(providerId);

  if (latest?.status === VERIFICATION_STATUS.APPROVED) {
    throw ApiError.conflict('Your account is already verified. Contact support to change your KYC details.');
  }
  if (latest?.status === VERIFICATION_STATUS.SUSPENDED) {
    throw ApiError.forbidden('Your account is suspended. Contact support before re-submitting.');
  }

  // An open submission is edited in place rather than duplicated; the partial
  // unique index in the schema enforces this too.
  if (latest && OPEN_STATES.includes(latest.status)) {
    const updated = await repo.update(latest.id, { ...payload, status: VERIFICATION_STATUS.PENDING });
    const documents = await repo.listDocuments(updated.id);
    return { created: false, submission: presentSubmission(updated, documents) };
  }

  const submission = await withTransaction(async (tx) => {
    const created = await repo.create(tx, providerId, payload);
    await repo.setProviderVerification(tx, providerId, { status: VERIFICATION_STATUS.PENDING });
    await repo.recordReviewEvent(tx, {
      submissionId: created.id,
      adminId: null,
      fromStatus: latest?.status ?? VERIFICATION_STATUS.UNSUBMITTED,
      toStatus: VERIFICATION_STATUS.PENDING,
      notes: 'Submitted by provider',
    });
    return created;
  });

  return { created: true, submission: presentSubmission(submission, []) };
}

/**
 * The agency's own verification.
 *
 * Mirrors the provider flow deliberately - same table, same documents, same
 * review queue - because an admin should not have to learn a second process
 * to approve a business rather than a person.
 */
export async function submitAgency(agencyId, payload) {
  const latest = await repo.findLatestForAgency(agencyId);

  if (latest?.status === VERIFICATION_STATUS.APPROVED) {
    throw ApiError.conflict('Your agency is already verified. Contact support to change these details.');
  }
  if (latest?.status === VERIFICATION_STATUS.SUSPENDED) {
    throw ApiError.forbidden('Your agency is suspended. Contact support before re-submitting.');
  }

  if (latest && OPEN_STATES.includes(latest.status)) {
    const updated = await repo.update(latest.id, { ...payload, status: VERIFICATION_STATUS.PENDING });
    const documents = await repo.listDocuments(updated.id);
    return { created: false, submission: presentSubmission(updated, documents) };
  }

  const submission = await withTransaction(async (tx) => {
    const created = await repo.createForAgency(tx, agencyId, payload);
    // The agency is waiting, not its people. Marking them pending too would
    // be untrue, and would later exclude them from the approval cascade.
    await repo.setAgencyVerification(tx, agencyId, {
      status: VERIFICATION_STATUS.PENDING,
      cascade: false,
    });
    await repo.recordReviewEvent(tx, {
      submissionId: created.id,
      adminId: null,
      fromStatus: latest?.status ?? VERIFICATION_STATUS.UNSUBMITTED,
      toStatus: VERIFICATION_STATUS.PENDING,
      notes: 'Submitted by agency',
    });
    return created;
  });

  return { created: true, submission: presentSubmission(submission, []) };
}

export async function getAgencySubmission(agencyId) {
  const submission = await repo.findLatestForAgency(agencyId);

  if (!submission) {
    return {
      status: VERIFICATION_STATUS.UNSUBMITTED,
      submission: null,
      requiredDocuments: REQUIRED_DOCS,
      canSubmit: true,
    };
  }

  const documents = await repo.listDocuments(submission.id);
  const uploaded = new Set(documents.map((d) => d.doc_type));

  return {
    status: submission.status,
    submission: presentSubmission(submission, documents),
    requiredDocuments: REQUIRED_DOCS,
    missingDocuments: REQUIRED_DOCS.filter((d) => !uploaded.has(d)),
    canSubmit: [VERIFICATION_STATUS.REJECTED, VERIFICATION_STATUS.INFO_REQUESTED].includes(submission.status),
    history: await repo.reviewHistory(submission.id),
  };
}

export async function uploadAgencyDocument(agencyId, { docType, file }) {
  const submission = await repo.findOpenForAgency(agencyId);
  if (!submission) {
    throw ApiError.badRequest('Submit your agency details before uploading documents');
  }

  const key = storage.buildKey({ scope: 'kyc', ownerId: agencyId, originalName: file.originalname });
  await storage.put(key, file.buffer);

  const document = await repo.addDocument(submission.id, {
    docType,
    storageKey: key,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  });

  return presentDocument(document);
}

/** Removing a document is scoped to the agency's own open submission. */
export async function removeAgencyDocument(agencyId, documentId) {
  const submission = await repo.findOpenForAgency(agencyId);
  if (!submission) throw ApiError.notFound('No open submission');

  const removed = await repo.removeDocument(submission.id, documentId);
  if (!removed) throw ApiError.notFound('Document not found');

  await storage.remove(removed.storage_key).catch(() => {});
  return { id: documentId, removed: true };
}

export async function uploadDocument(providerId, { docType, file }) {
  const submission = await repo.findOpenForProvider(providerId);
  if (!submission) {
    throw ApiError.badRequest('Submit your KYC details before uploading documents');
  }

  const key = storage.buildKey({
    scope: 'kyc',
    ownerId: providerId,
    originalName: file.originalname,
  });

  await storage.put(key, file.buffer);

  const document = await repo.addDocument(submission.id, {
    docType,
    storageKey: key,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  });

  return presentDocument(document);
}

export async function removeDocument(providerId, documentId) {
  const submission = await repo.findOpenForProvider(providerId);
  if (!submission) throw ApiError.badRequest('You have no submission open for editing');

  const removed = await repo.removeDocument(submission.id, documentId);
  if (!removed) throw ApiError.notFound('Document not found');

  await storage.remove(removed.storage_key).catch(() => {});
  return { removed: true, id: documentId };
}

// ---------------------------------------------------------------- admin side

export async function reviewQueue({ status, search, page, limit, offset }) {
  const { items, total } = await repo.queue({ status, search, limit, offset });

  return {
    items: items.map((s) => ({
      id: s.id,
      providerId: s.provider_id,
      agencyId: s.agency_id,
      // What is being verified. An agency decision carries to everyone it
      // employs, so an admin has to be able to see which kind this is.
      subjectType: s.subject_type,
      status: s.status,
      provider: {
        fullName: s.full_name,
        email: s.email,
        phone: s.phone,
        avatarUrl: s.avatar_url,
        businessName: s.business_name,
        experienceYears: s.experience_years,
      },
      legalName: s.full_legal_name,
      idProofType: s.id_proof_type,
      city: s.city,
      state: s.state,
      documentCount: s.document_count,
      serviceCount: s.service_count,
      // Trades like electrical work and AC gas handling legally need a licence,
      // so the queue flags them for a stricter look.
      needsCertification: s.needs_certification,
      submittedAt: s.submitted_at,
      waitingDays: Math.floor((Date.now() - new Date(s.submitted_at).getTime()) / 86400000),
    })),
    page,
    limit,
    total,
  };
}

export async function queueCounts() {
  const row = await repo.queueCounts();
  return {
    pending: row.pending,
    infoRequested: row.info_requested,
    approved: row.approved,
    rejected: row.rejected,
    waitingOver48h: row.waiting_over_48h,
  };
}

export async function getSubmission(submissionId) {
  const s = await repo.findSubmissionDetail(submissionId);
  if (!s) throw ApiError.notFound('KYC submission not found');

  const [documents, history] = await Promise.all([
    repo.listDocuments(submissionId),
    repo.reviewHistory(submissionId),
  ]);

  return {
    ...presentSubmission(s, documents),
    subjectType: s.subject_type,
    // Only meaningful for an agency: how many people inherit this decision.
    agencyProviderCount: s.agency_provider_count ?? 0,
    provider: {
      id: s.provider_id,
      fullName: s.full_name,
      email: s.email,
      phone: s.phone,
      avatarUrl: s.avatar_url,
      businessName: s.business_name,
      headline: s.headline,
      experienceYears: s.experience_years,
      skills: s.skills ?? [],
      languages: s.languages ?? [],
      accountCreatedAt: s.account_created_at,
      verificationStatus: s.provider_status,
      isAcceptingBookings: s.is_accepting_bookings,
    },
    history,
  };
}

/**
 * The approval that makes a provider commercially live.
 *
 * Refuses to approve a submission missing a required document, because the
 * whole point of the gate is that somebody actually looked at the identity and
 * address proof before letting this person into a customer's home.
 */
/**
 * Applies a verification decision to whichever subject the submission is for.
 *
 * Approving an agency approves everyone it employs, because the agency is
 * what was checked and the providers inherit it. Rejecting or suspending one
 * takes them all offline for the same reason - if the business is not trusted,
 * the people it put forward cannot be either.
 */
async function applyDecision(tx, submission, { status, adminId, goOffline = false }) {
  if (submission.agency_id) {
    const agency = await repo.setAgencyVerification(tx, submission.agency_id, { status, adminId });
    return {
      user_id: agency.user_id,
      verification_status: agency.verification_status,
      subject: 'agency',
      subjectName: agency.name,
      cascaded: agency.cascaded,
    };
  }

  const profile = await repo.setProviderVerification(tx, submission.provider_id, {
    status, adminId, goOffline,
  });
  return { ...profile, subject: 'provider', cascaded: 0 };
}

export async function approve(submissionId, adminId, { notes, expiresAt } = {}) {
  const submission = await repo.findById(submissionId);
  if (!submission) throw ApiError.notFound('KYC submission not found');

  if (submission.status === VERIFICATION_STATUS.APPROVED) {
    throw ApiError.conflict('This submission is already approved');
  }

  const documents = await repo.listDocuments(submissionId);
  const uploaded = new Set(documents.map((d) => d.doc_type));
  const missing = REQUIRED_DOCS.filter((d) => !uploaded.has(d));

  if (missing.length) {
    throw ApiError.badRequest(
      'Cannot approve: ' +
        (submission.agency_id ? 'this agency' : 'the provider') +
        ' has not uploaded ' + listDocs(missing),
    );
  }

  const result = await withTransaction(async (tx) => {
    const decided = await repo.decide(tx, submissionId, {
      status: VERIFICATION_STATUS.APPROVED, adminId, notes, expiresAt,
    });
    const profile = await applyDecision(tx, submission, {
      status: VERIFICATION_STATUS.APPROVED, adminId,
    });
    await repo.recordReviewEvent(tx, {
      submissionId, adminId, fromStatus: submission.status,
      toStatus: VERIFICATION_STATUS.APPROVED, notes,
    });
    return { decided, profile };
  });

  notifyAsync({
    userId: result.profile.user_id,
    eventType: 'kyc.approved',
    title: 'Your account is verified',
    body:
      result.profile.subject === 'agency'
        ? 'Your agency is verified. ' +
          (result.profile.cascaded
            ? 'All ' + result.profile.cascaded + ' of your people can now take bookings.'
            : 'Anyone you add from now on can take bookings straight away.')
        : 'You can now go online and start accepting bookings on ServiceMitra.',
    entityType: 'kyc_submission',
    entityId: submissionId,
  });

  return {
    submission: presentSubmission(result.decided, documents),
    providerStatus: result.profile.verification_status,
  };
}

export async function reject(submissionId, adminId, { reason, notes }) {
  const submission = await repo.findById(submissionId);
  if (!submission) throw ApiError.notFound('KYC submission not found');

  const result = await withTransaction(async (tx) => {
    const decided = await repo.decide(tx, submissionId, {
      status: VERIFICATION_STATUS.REJECTED, adminId, notes, rejectionReason: reason,
    });
    // A rejected subject goes offline immediately, not at their convenience.
    const profile = await applyDecision(tx, submission, {
      status: VERIFICATION_STATUS.REJECTED, adminId, goOffline: true,
    });
    await repo.recordReviewEvent(tx, {
      submissionId, adminId, fromStatus: submission.status,
      toStatus: VERIFICATION_STATUS.REJECTED, notes: reason,
    });
    return { decided, profile };
  });

  notifyAsync({
    userId: result.profile.user_id,
    eventType: 'kyc.rejected',
    title: 'Your verification was not approved',
    body: reason + ' You can correct the details and submit again.',
    entityType: 'kyc_submission',
    entityId: submissionId,
  });

  return {
    submission: presentSubmission(result.decided),
    providerStatus: result.profile.verification_status,
  };
}

/** Neither approval nor rejection - the admin needs something more first. */
export async function requestInfo(submissionId, adminId, { message }) {
  const submission = await repo.findById(submissionId);
  if (!submission) throw ApiError.notFound('KYC submission not found');

  const result = await withTransaction(async (tx) => {
    const decided = await repo.decide(tx, submissionId, {
      status: VERIFICATION_STATUS.INFO_REQUESTED, adminId, notes: message,
    });
    const profile = await applyDecision(tx, submission, {
      status: VERIFICATION_STATUS.INFO_REQUESTED, adminId,
    });
    await repo.recordReviewEvent(tx, {
      submissionId, adminId, fromStatus: submission.status,
      toStatus: VERIFICATION_STATUS.INFO_REQUESTED, notes: message,
    });
    return { decided, profile };
  });

  notifyAsync({
    userId: result.profile.user_id,
    eventType: 'kyc.info_requested',
    title: 'More information needed',
    body: message,
    entityType: 'kyc_submission',
    entityId: submissionId,
  });

  return {
    submission: presentSubmission(result.decided),
    providerStatus: result.profile.verification_status,
  };
}

/**
 * Suspension and reinstatement act on the provider, not on a submission - a
 * provider may be suspended long after approval, over conduct rather than
 * paperwork.
 */
export async function setProviderStatus(providerId, adminId, { status, reason }) {
  const allowed = [VERIFICATION_STATUS.SUSPENDED, VERIFICATION_STATUS.APPROVED];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest('Status must be either suspended or approved');
  }

  const profile = await withTransaction((tx) =>
    repo.setProviderVerification(tx, providerId, {
      status, adminId, goOffline: status === VERIFICATION_STATUS.SUSPENDED,
    }),
  );

  if (!profile) throw ApiError.notFound('Provider not found');

  const suspended = status === VERIFICATION_STATUS.SUSPENDED;
  notifyAsync({
    userId: profile.user_id,
    eventType: suspended ? 'provider.suspended' : 'provider.reinstated',
    title: suspended ? 'Your account has been suspended' : 'Your account has been reinstated',
    body: reason || (suspended
      ? 'Contact ServiceMitra support for details.'
      : 'You can go online again and accept bookings.'),
  });

  return {
    providerId,
    verificationStatus: profile.verification_status,
    isAcceptingBookings: profile.is_accepting_bookings,
  };
}

export { REQUIRED_DOCS };
