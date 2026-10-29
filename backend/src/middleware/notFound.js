import ApiError from '../utils/ApiError.js';

/** Any request that reaches here matched no route. */
export function notFound(req, _res, next) {
  next(ApiError.notFound('Route ' + req.method + ' ' + req.originalUrl + ' does not exist'));
}

export default notFound;
