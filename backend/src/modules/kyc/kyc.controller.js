import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created, paginated } from '../../utils/apiResponse.js';
import ApiError from '../../utils/ApiError.js';
import { q } from '../../middleware/validate.js';
import { assertRealFile } from '../../middleware/upload.js';
import { getPagination } from '../../utils/pagination.js';
import { record, AUDIT } from '../../services/audit.service.js';
import * as storage from '../../storage/storage.service.js';
import * as service from './kyc.service.js';

function myProviderId(req) {
  if (!req.user?.providerId) {
    throw ApiError.forbidden('This account does not have a service provider profile');
  }
  return req.user.providerId;
}

// ---------- provider ----------

export const getMine = asyncHandler(async (req, res) =>
  ok(res, await service.getMySubmission(myProviderId(req))),
);

export const submit = asyncHandler(async (req, res) => {
  const result = await service.submit(myProviderId(req), req.body);
  return result.created
    ? created(res, result.submission, 'KYC submitted. Upload your documents to complete it.')
    : ok(res, result.submission, { message: 'KYC details updated and re-submitted for review' });
});

export const uploadDocument = asyncHandler(async (req, res) => {
  // The declared type is checked against the file's actual magic bytes, so a
  // script renamed to .jpg does not reach storage.
  assertRealFile(req.file);
  const document = await service.uploadDocument(myProviderId(req), {
    docType: req.body.docType,
    file: req.file,
  });
  return created(res, document, 'Document uploaded');
});

export const removeDocument = asyncHandler(async (req, res) =>
  ok(res, await service.removeDocument(myProviderId(req), req.params.id), { message: 'Document removed' }),
);

// ---------- agency verification ----------

function myAgencyId(req) {
  if (!req.user?.agencyId) {
    throw ApiError.forbidden('This account does not have an agency profile');
  }
  return req.user.agencyId;
}

export const getAgencyKyc = asyncHandler(async (req, res) =>
  ok(res, await service.getAgencySubmission(myAgencyId(req))),
);

export const submitAgencyKyc = asyncHandler(async (req, res) => {
  const result = await service.submitAgency(myAgencyId(req), req.body);
  return result.created
    ? created(res, result.submission, 'Agency details submitted. Upload your documents to complete it.')
    : ok(res, result.submission, { message: 'Agency details updated and re-submitted for review' });
});

export const uploadAgencyDocument = asyncHandler(async (req, res) => {
  assertRealFile(req.file);
  const document = await service.uploadAgencyDocument(myAgencyId(req), {
    docType: req.body.docType,
    file: req.file,
  });
  return created(res, document, 'Document uploaded');
});

export const removeAgencyDocument = asyncHandler(async (req, res) =>
  ok(res, await service.removeAgencyDocument(myAgencyId(req), req.params.id), {
    message: 'Document removed',
  }),
);

// ---------- signed file delivery ----------

/**
 * Serves one private file against a signed, time-limited URL. There is no
 * other route to a KYC document - the storage path alone is never enough.
 */
export const serveFile = asyncHandler(async (req, res) => {
  const { key, expires, signature, ct, name } = q(req);
  storage.verifySignedUrl({ key, expires, signature, ct, name });

  // The type is only honoured if it is one a browser may safely render. Any
  // other file is handed back as opaque bytes, so it can be downloaded and
  // inspected but never executed in the reviewer's session.
  const inline = storage.isServableInline(ct);
  const filename = name || 'document';

  const fileStream = await storage.stream(key);

  res.setHeader('Cache-Control', 'private, no-store');
  // nosniff matters most in the download case: it stops the browser guessing
  // a renderable type for the bytes when we deliberately declined to name one.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', inline ? ct : 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    (inline ? 'inline' : 'attachment') + '; filename="' + filename.replace(/"/g, '') + '"',
  );

  fileStream.on('error', () => {
    if (!res.headersSent) res.status(404);
    res.end();
  });
  fileStream.pipe(res);
});

// ---------- admin ----------

export const queue = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);
  const result = await service.reviewQueue({ ...query, page, limit, offset });
  return paginated(res, result.items, { page, limit, total: result.total });
});

export const counts = asyncHandler(async (_req, res) => ok(res, await service.queueCounts()));

export const detail = asyncHandler(async (req, res) =>
  ok(res, await service.getSubmission(req.params.id)),
);

export const approve = asyncHandler(async (req, res) => {
  const result = await service.approve(req.params.id, req.user.id, req.body);
  await record(req, {
    action: AUDIT.PROVIDER_APPROVED,
    entityType: 'kyc_submission',
    entityId: req.params.id,
    after: { status: 'approved', providerId: result.submission.providerId },
    reason: req.body.notes ?? null,
  });
  return ok(res, result, { message: 'Provider verified and cleared to go live' });
});

export const reject = asyncHandler(async (req, res) => {
  const result = await service.reject(req.params.id, req.user.id, req.body);
  await record(req, {
    action: AUDIT.PROVIDER_REJECTED,
    entityType: 'kyc_submission',
    entityId: req.params.id,
    after: { status: 'rejected' },
    reason: req.body.reason,
  });
  return ok(res, result, { message: 'Submission rejected and the provider has been notified' });
});

export const requestInfo = asyncHandler(async (req, res) => {
  const result = await service.requestInfo(req.params.id, req.user.id, req.body);
  await record(req, {
    action: 'kyc.info_requested',
    entityType: 'kyc_submission',
    entityId: req.params.id,
    reason: req.body.message,
  });
  return ok(res, result, { message: 'Information requested from the provider' });
});

export const setProviderStatus = asyncHandler(async (req, res) => {
  const result = await service.setProviderStatus(req.params.id, req.user.id, req.body);
  await record(req, {
    action: req.body.status === 'suspended' ? AUDIT.PROVIDER_SUSPENDED : AUDIT.PROVIDER_APPROVED,
    entityType: 'provider_profile',
    entityId: req.params.id,
    after: result,
    reason: req.body.reason ?? null,
  });
  return ok(res, result, {
    message: req.body.status === 'suspended' ? 'Provider suspended' : 'Provider reinstated',
  });
});

export default {
  getMine, submit, uploadDocument, removeDocument, serveFile,
  getAgencyKyc, submitAgencyKyc, uploadAgencyDocument, removeAgencyDocument,
  queue, counts, detail, approve, reject, requestInfo, setProviderStatus,
};
