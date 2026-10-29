/** Every successful response has the same envelope, so the frontend has one parser. */
export function ok(res, data, { message = 'OK', status = 200, meta } = {}) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function created(res, data, message = 'Created successfully') {
  return ok(res, data, { message, status: 201 });
}

export function noContent(res) {
  return res.status(204).send();
}

/** Paginated list response. `meta` carries what the UI needs to render a pager. */
/**
 * `extra` rides alongside the paging numbers for anything that describes the
 * whole result rather than the page of it - a rating breakdown, a set of
 * totals. It keeps `data` a plain array, so every existing caller reads the
 * list exactly as it did before.
 */
export function paginated(res, items, { page, limit, total, message = 'OK' }, extra = {}) {
  return ok(res, items, {
    message,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
      ...extra,
    },
  });
}

export default { ok, created, noContent, paginated };
