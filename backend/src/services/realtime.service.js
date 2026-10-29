/**
 * Server-sent events for live job tracking.
 *
 * The architecture calls for polling by default and push where latency is
 * what makes the product feel alive - a customer watching a technician's job
 * status, and a provider's incoming-request screen. SSE covers exactly that:
 * one-way server-to-client, over plain HTTP, with automatic browser reconnect
 * and no extra dependency.
 *
 * Subscribers are held in memory, which is correct for a single instance. With
 * more than one API instance behind a load balancer this needs a Redis pub/sub
 * fan-out so an event raised on instance A reaches a client connected to
 * instance B - that arrives with the queue in Phase 12.
 */
import logger from '../config/logger.js';

/** userId -> Set of open connections. */
const subscribers = new Map();

const HEARTBEAT_MS = 25_000;

function write(res, { event, data, id }) {
  try {
    if (id) res.write('id: ' + id + '\n');
    if (event) res.write('event: ' + event + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
    return true;
  } catch (err) {
    logger.debug({ err }, 'Dropped a closed SSE connection');
    return false;
  }
}

/**
 * Registers an open response as a subscriber. Returns the cleanup function,
 * which the route must call when the request closes.
 */
export function subscribe(userId, res, { channel = 'user' } = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Nginx buffers by default, which would hold events back until the buffer
  // fills - exactly the latency this endpoint exists to avoid.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const connection = { res, channel };

  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId).add(connection);

  write(res, { event: 'connected', data: { channel, at: new Date().toISOString() } });

  // Keeps proxies from closing an idle connection.
  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  logger.debug({ userId, channel, total: subscribers.get(userId).size }, 'SSE subscriber attached');

  return function unsubscribe() {
    clearInterval(heartbeat);
    const set = subscribers.get(userId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) subscribers.delete(userId);
  };
}

/** Pushes an event to every open connection for one user. */
export function publishToUser(userId, event, data) {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return 0;

  let delivered = 0;
  for (const connection of [...set]) {
    if (write(connection.res, { event, data })) delivered += 1;
    else set.delete(connection);
  }

  return delivered;
}

/** Pushes the same event to both sides of a booking. */
export function publishToBooking({ customerUserId, providerUserId }, event, data) {
  return (
    publishToUser(customerUserId, event, data) + publishToUser(providerUserId, event, data)
  );
}

export function connectionCount(userId) {
  return subscribers.get(userId)?.size ?? 0;
}

/** Closes every connection - used on graceful shutdown. */
export function closeAll() {
  for (const [, set] of subscribers) {
    for (const connection of set) {
      try {
        connection.res.end();
      } catch {
        // Already gone.
      }
    }
  }
  subscribers.clear();
}

export default { subscribe, publishToUser, publishToBooking, connectionCount, closeAll };
