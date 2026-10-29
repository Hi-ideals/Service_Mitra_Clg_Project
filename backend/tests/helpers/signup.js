/**
 * Registering an account, the way a real person now has to.
 *
 * Registration hands back no session: it creates the account and sends a code,
 * and confirming that code is what issues the tokens. Most suites here are not
 * about that flow - they need a working account so they can test bookings, or
 * KYC, or payouts - so they go through this instead of repeating both steps.
 *
 * The code comes back in the response as `devCode`, which only happens when
 * the mail driver is the console one. That is the same mechanism the
 * development server uses so nobody has to read a log to sign up locally.
 */

/**
 * @param request  the suite's own request helper, (port, method, path, opts)
 * @param port     where the app under test is listening
 * @param body     the registration payload
 * @returns        the confirmation response, whose data holds user + tokens
 */
export async function registerAndConfirm(request, port, body) {
  const registered = await request(port, 'POST', '/api/v1/auth/register', { body });

  // Left to the caller to assert on. A suite checking that a weak password is
  // rejected wants the failure, not an exception from in here.
  if (registered.status !== 201) return registered;

  const { destination, devCode } = registered.body.data.verification;
  if (!devCode) {
    throw new Error(
      'No devCode in the registration response - the test environment must use ' +
      'EMAIL_DRIVER=console, or this helper cannot confirm the account.',
    );
  }

  const confirmed = await request(port, 'POST', '/api/v1/auth/otp/verify', {
    body: { destination, code: devCode },
  });

  if (confirmed.status !== 200) {
    throw new Error('Could not confirm the new account: ' + JSON.stringify(confirmed.body));
  }

  // Shaped like the registration response used to be, so a suite that only
  // wanted an account reads the same as it did before.
  return { ...confirmed, status: 201, registration: registered };
}

export default { registerAndConfirm };
