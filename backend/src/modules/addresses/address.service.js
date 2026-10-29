import ApiError from '../../utils/ApiError.js';
import * as repo from './address.repository.js';

/** The shape the client sees. Column names never leave this layer. */
function present(a) {
  return {
    id: a.id,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    landmark: a.landmark,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    latitude: a.latitude,
    longitude: a.longitude,
    isDefault: a.is_default,
    // What the booking form needs as one string, assembled here so every
    // caller shows the same thing.
    line: [a.line1, a.line2, a.landmark].filter(Boolean).join(', '),
    createdAt: a.created_at,
  };
}

export async function list(userId) {
  return (await repo.listForUser(userId)).map(present);
}

export async function create(userId, payload) {
  const saved = await repo.create(userId, payload);
  return present(saved);
}

export async function setDefault(id, userId) {
  const existing = await repo.findForUser(id, userId);
  if (!existing) throw ApiError.notFound('That address does not exist');
  return present(await repo.setDefault(id, userId));
}

export async function remove(id, userId) {
  const removed = await repo.remove(id, userId);
  // 404 rather than a silent success: a delete that quietly does nothing looks
  // identical to one that worked, and the list not changing looks like a bug.
  if (!removed) throw ApiError.notFound('That address does not exist');
  return { id: removed.id };
}

export default { list, create, setDefault, remove };
