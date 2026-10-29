/** Normalises page/limit query parameters into safe LIMIT/OFFSET values. */
export function getPagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.limit, 10) || defaultLimit;
  const limit = Math.min(Math.max(1, requested), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

export default getPagination;
