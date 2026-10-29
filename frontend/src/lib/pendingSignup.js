/**
 * The half-finished signup, held in memory and nowhere else.
 *
 * Deliberately a module variable rather than router state, the URL, or
 * storage. All three of those survive a page reload - router state in
 * particular lives in `history.state`, which the browser restores - and the
 * rule for this flow is that a reload starts again at the beginning.
 *
 * So the lifetime of this value is the lifetime of the page. Refresh, close
 * the tab, come back tomorrow: it is gone, and the verify screen sends you
 * back to create the account, where registering again replaces the
 * unconfirmed record and sends a fresh code.
 *
 * Nothing secret is kept here. The code itself is never held - only where it
 * was sent, so the screen can say so.
 */
let pending = null;

export function setPendingSignup(details) {
  pending = details;
}

export function getPendingSignup() {
  return pending;
}

export function clearPendingSignup() {
  pending = null;
}

export default { setPendingSignup, getPendingSignup, clearPendingSignup };
