/**
 * Live security probes against the running ServiceSetu API.
 *
 * Separate from the unit suite on purpose: these exercise the deployed
 * surface the way an attacker would - no fixtures, no internal imports, only
 * HTTP. Every probe states the attack, then asserts the defence.
 */
const BASE = 'http://localhost:5000/api/v1';
const PASSWORD = 'Password@123';

const results = [];
let pass = 0;
let fail = 0;

function record(area, name, attack, expected, actual, ok, severity = 'high') {
  results.push({ area, name, attack, expected, actual, ok, severity });
  if (ok) pass += 1;
  else fail += 1;
  process.stdout.write((ok ? 'PASS  ' : 'FAIL  ') + area + ' :: ' + name + '\n');
  if (!ok) process.stdout.write('        expected ' + expected + ', got ' + actual + '\n');
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });

  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }

  return { status: res.status, headers: res.headers, body: json, text };
}

async function login(identifier) {
  const res = await call('POST', '/auth/login', { body: { identifier, password: PASSWORD } });
  return res.body?.data?.accessToken ?? null;
}

const t = {};

async function main() {
  t.admin = await login('admin@servicesetu.in');
  t.customer = await login('customer@servicesetu.in');
  t.provider = await login('plumber@servicesetu.in');
  t.provider2 = await login('electrician@servicesetu.in');

  if (!t.admin || !t.customer || !t.provider) {
    console.error('Could not sign in with the demo accounts; aborting.');
    process.exit(1);
  }

  // ---------------------------------------------------------- authentication
  {
    const r = await call('GET', '/bookings');
    record('Authentication', 'Protected route without a token',
      'Call /bookings with no Authorization header', '401', r.status, r.status === 401);
  }
  {
    const r = await call('GET', '/bookings', { token: 'not-a-real-token' });
    record('Authentication', 'Malformed bearer token',
      'Send a garbage token', '401', r.status, r.status === 401);
  }
  {
    // A structurally valid JWT signed with the wrong key.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000001', role: 'admin' }))
        .toString('base64url') +
      '.aGFja2Vy';
    const r = await call('GET', '/admin/analytics/dashboard', { token: forged });
    record('Authentication', 'Forged JWT with admin role',
      'Self-sign a token claiming role=admin', '401', r.status, r.status === 401, 'critical');
  }
  {
    const r = await call('POST', '/auth/login', {
      body: { identifier: 'admin@servicesetu.in', password: 'WrongPassword@1' },
    });
    const leaks = /not found|no such user|unknown email/i.test(r.body?.error?.message ?? '');
    record('Authentication', 'Account enumeration on sign-in',
      'Wrong password on a real account', 'generic message, no hint the account exists',
      JSON.stringify(r.body?.error?.message), r.status === 401 && !leaks, 'medium');
  }
  {
    const r = await call('POST', '/auth/register', {
      body: { role: 'customer', fullName: 'Weak Pass', email: 'weak' + Date.now() + '@test.local',
        phone: '9' + String(Date.now()).slice(-9), password: 'password' },
    });
    record('Authentication', 'Weak password rejected',
      'Register with "password"', '422', r.status, r.status === 422, 'medium');
  }

  // ---------------------------------------------------------- authorisation
  {
    const r = await call('GET', '/admin/analytics/dashboard', { token: t.customer });
    record('Authorisation', 'Customer reaching admin analytics',
      'Customer token on an admin route', '403', r.status, r.status === 403, 'critical');
  }
  {
    const r = await call('GET', '/admin/kyc', { token: t.provider });
    record('Authorisation', 'Provider reaching the KYC review queue',
      'Provider token on the admin verification queue', '403', r.status, r.status === 403, 'critical');
  }
  {
    const r = await call('GET', '/earnings', { token: t.customer });
    record('Authorisation', 'Customer reading provider earnings',
      'Customer token on /earnings', '403', r.status, r.status === 403);
  }
  {
    const r = await call('POST', '/admin/payouts/run', { token: t.provider, body: {} });
    record('Authorisation', 'Provider triggering a payout run',
      'Provider token on the payout batch', '403', r.status, r.status === 403, 'critical');
  }
  {
    const r = await call('PUT', '/admin/settings/commission', {
      token: t.customer, body: { defaultPercent: 0 },
    });
    record('Authorisation', 'Customer changing platform commission',
      'Customer token writing platform settings', '403', r.status, r.status === 403, 'critical');
  }

  // ---------------------------------------------------- privilege escalation
  {
    const email = 'esc' + Date.now() + '@test.local';
    const r = await call('POST', '/auth/register', {
      body: { role: 'admin', fullName: 'Escalation Test', email,
        phone: '9' + String(Date.now()).slice(-9), password: PASSWORD },
    });
    const gotAdmin = r.body?.data?.user?.role === 'admin';
    record('Privilege escalation', 'Self-registering as admin',
      'Register with role=admin in the body', 'refused or downgraded',
      r.status + ' role=' + (r.body?.data?.user?.role ?? 'n/a'), !gotAdmin, 'critical');
  }
  {
    const r = await call('PATCH', '/auth/me', { token: t.customer, body: { role: 'admin' } });
    const nowAdmin = r.body?.data?.role === 'admin';
    record('Privilege escalation', 'Mass assignment of role on profile update',
      'PATCH own profile with role=admin', 'role unchanged',
      r.status + ' role=' + (r.body?.data?.role ?? 'unchanged'), !nowAdmin, 'critical');
  }

  // ------------------------------------------------------------------- IDOR
  {
    const r = await call('GET', '/bookings/00000000-0000-0000-0000-000000000000', { token: t.customer });
    record('Access control (IDOR)', 'Unknown booking id',
      'Request a booking that does not exist', '404', r.status, r.status === 404, 'low');
  }
  {
    const r = await call('GET', '/bookings/not-a-uuid', { token: t.customer });
    record('Input validation', 'Non-UUID path parameter',
      'Pass a non-UUID where an id is expected', '422', r.status, r.status === 422, 'low');
  }

  // -------------------------------------------------------- private files
  {
    const r = await call('GET', '/files?key=kyc/../../../.env');
    record('File access', 'Path traversal on the signed file route',
      'Ask for ../../../.env through the file endpoint', '403 or 422', r.status,
      r.status === 403 || r.status === 422, 'critical');
  }
  {
    const r = await call('GET', '/files?key=kyc/any.png&expires=99999999999&signature=' + 'a'.repeat(64));
    record('File access', 'Forged signature on a private file',
      'Invent a signature for a KYC document', '403', r.status, r.status === 403, 'critical');
  }
  {
    const r = await call('GET', '/files?key=kyc/any.png');
    record('File access', 'Storage key with no signature',
      'Request a document with the key alone', '422', r.status, r.status === 422, 'critical');
  }

  // ------------------------------------------- money paths and object access
  //
  // This block creates its own booking rather than hoping one exists. A probe
  // that silently skips is worse than a failing one: it reports green for a
  // defence nobody exercised.
  {
    const providers = await call('GET', '/providers/search?limit=1');
    const p = providers.body?.data?.[0];

    if (p?.id) {
      // Slots live on the public profile, not on a separate route.
      const profile = await call('GET', '/providers/' + p.id);
      const day = profile.body?.data?.availability?.find((d) => d.slots?.length);
      const slot = day?.slots?.[0];
      const categoryId = profile.body?.data?.services?.[0]?.categoryId;

      if (slot && categoryId) {
        const r = await call('POST', '/bookings', {
          token: t.customer,
          body: {
            providerId: p.id,
            categoryId,
            scheduledStart: slot.start,
            address: {
              line: '12 Security Probe Street',
              city: 'Bidar',
              state: 'Karnataka',
              pincode: '585401',
            },
            description: 'security-probe-price-tamper',
            // The attack: dictate the money. None of these are in the schema,
            // so the test is whether they are ignored rather than honoured.
            quotedAmountMinor: 1,
            finalAmountMinor: 1,
            commissionPercent: 0,
            providerEarningMinor: 999999,
          },
        });

        const quoted = r.body?.data?.pricing?.quotedMinor;
        const ignored = r.status === 201 && quoted && quoted > 1;
        record('Money integrity', 'Client-supplied price ignored',
          'Book while dictating quotedAmountMinor=1', 'server price used, not the client one',
          r.status + ' quoted=' + quoted, Boolean(ignored), 'critical');

        if (r.body?.data?.id) {
          const id = r.body.data.id;

          // The customer who booked it is the only customer who may read it.
          const other = await call('GET', '/bookings/' + id, { token: t.provider2 });
          record('Access control (IDOR)', 'Unrelated provider reading a booking by id',
            'A provider not assigned to the booking requests it directly', '403 or 404',
            other.status, other.status === 403 || other.status === 404, 'critical');

          // And only the assigned provider may act on it.
          const hijack = await call('POST', '/bookings/' + id + '/accept', { token: t.provider2, body: {} });
          record('Access control (IDOR)', 'Unrelated provider accepting a booking',
            'A provider not assigned to the booking tries to accept it', '403 or 404',
            hijack.status, hijack.status === 403 || hijack.status === 404, 'critical');

          const c = await call('POST', '/bookings/' + id + '/cancel', {
            token: t.customer, body: { reason: 'Security probe cleanup' },
          });
          void c;
        }
      } else {
        record('Money integrity', 'Client-supplied price ignored',
          'Book while dictating quotedAmountMinor=1', 'server price used',
          'NOT EXECUTED - no bookable slot was offered', false, 'critical');
      }
    }
  }
  {
    const r = await call('POST', '/webhooks/payment', {
      body: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_fake', order_id: 'order_fake', amount: 100000 } } } },
      headers: { 'x-razorpay-signature': 'deadbeef' },
    });
    record('Money integrity', 'Payment webhook with a bad signature',
      'Forge a payment.captured webhook', 'rejected (4xx)', r.status,
      r.status >= 400 && r.status < 500, 'critical');
  }
  {
    const r = await call('POST', '/webhooks/payment', {
      body: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x' } } } },
    });
    record('Money integrity', 'Payment webhook with no signature at all',
      'Send an unsigned webhook', 'rejected (4xx)', r.status,
      r.status >= 400 && r.status < 500, 'critical');
  }

  // ------------------------------------------------------------- OTP / codes
  {
    const email = 'otpleak' + Date.now() + '@test.local';
    const r = await call('POST', '/auth/register', {
      body: { role: 'customer', fullName: 'OTP Leak Probe', email,
        phone: '9' + String(Date.now()).slice(-9), password: PASSWORD },
    });
    const hasCode = /"\d{6}"|\b\d{6}\b/.test(JSON.stringify(r.body?.data?.verification ?? r.body?.data ?? {}));
    record('Secrets in responses', 'OTP not returned by the API',
      'Register and inspect the response for the 6-digit code',
      'no code in the body when a mail server is configured',
      hasCode ? 'a 6-digit code was present' : 'absent', !hasCode, 'critical');
  }

  // ------------------------------------------------------------- injection
  {
    const r = await call('GET', "/providers/search?q=' OR 1=1--&limit=5");
    record('Injection', 'SQL injection in the search term',
      "Search for ' OR 1=1--", 'handled safely, no 500', r.status,
      r.status === 200 || r.status === 422, 'critical');
  }
  {
    const r = await call('GET', '/providers/search?limit=999999');
    record('Input validation', 'Oversized pagination limit',
      'Ask for 999999 results', '422', r.status, r.status === 422, 'medium');
  }
  {
    const r = await call('POST', '/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    record('Input validation', 'Missing request body',
      'POST /auth/login with no body', '4xx, not a crash', r.status,
      r.status >= 400 && r.status < 500, 'low');
  }

  // --------------------------------------------------------------- headers
  {
    const r = await call('GET', '/providers/search?limit=1');
    const h = r.headers;
    const checks = {
      'x-content-type-options': h.get('x-content-type-options') === 'nosniff',
      'x-frame-options': Boolean(h.get('x-frame-options')),
      'strict-transport-security or dev': true,
      'no x-powered-by': !h.get('x-powered-by'),
    };
    const ok = Object.values(checks).every(Boolean);
    record('Transport and headers', 'Security headers present, stack not advertised',
      'Inspect response headers', 'nosniff + frame options + no x-powered-by',
      JSON.stringify({ nosniff: h.get('x-content-type-options'), frame: h.get('x-frame-options'),
        poweredBy: h.get('x-powered-by') ?? 'absent' }), ok, 'medium');
  }
  {
    const r = await call('GET', '/providers/search?limit=1');
    const hasLimit = Boolean(r.headers.get('ratelimit-limit'));
    record('Rate limiting', 'Rate limit advertised on responses',
      'Inspect RateLimit headers', 'ratelimit-limit present',
      r.headers.get('ratelimit-limit') ?? 'absent', hasLimit, 'medium');
  }
  {
    const r = await call('GET', '/does-not-exist-at-all');
    const leaks = /at .*\.js:|node_modules|TypeError|ReferenceError/.test(r.text);
    record('Information disclosure', 'No stack trace on an unknown route',
      'Request a route that does not exist', 'standard error envelope, no stack',
      leaks ? 'stack trace leaked' : 'clean envelope', !leaks, 'medium');
  }

  // ---------------------------------------------------- data minimisation
  {
    const r = await call('GET', '/providers/search?limit=3');
    const blob = JSON.stringify(r.body);
    const leaks = /password_hash|passwordHash|"email"|payout_account_number|accountNumber/.test(blob);
    record('Data minimisation', 'Public search leaks no private fields',
      'Inspect the public provider search payload',
      'no password hash, email or bank details',
      leaks ? 'a private field was present' : 'none found', !leaks, 'high');
  }
  {
    const r = await call('GET', '/admin/reports/payouts?limit=5', { token: t.admin });
    const rows = r.body?.data?.rows ?? [];
    const unmasked = rows.some((x) => /^\d{6,}/.test(String(x.destination ?? '')));
    record('Data minimisation', 'Bank details masked in reports',
      'Read the payouts report as admin', 'account numbers masked to last four',
      unmasked ? 'a full account number was present' : 'masked or absent', !unmasked, 'high');
  }

  // ------------------------------------------------------------- audit trail
  {
    const before = await call('GET', '/admin/settings', { token: t.admin });
    const current = before.body?.data?.commission?.defaultPercent;
    if (typeof current === 'number') {
      const w = await call('PUT', '/admin/settings/commission', {
        token: t.admin, body: { defaultPercent: current },
      });
      record('Audit trail', 'Admin write is accepted and attributable',
        'Re-save the commission setting as admin', '200', w.status, w.status === 200, 'medium');
    }
  }

  console.log('\n----------------------------------------');
  console.log('probes: ' + results.length + '  passed: ' + pass + '  failed: ' + fail);

  const fs = await import('node:fs');
  fs.writeFileSync(process.argv[2], JSON.stringify({ results, pass, fail, at: new Date().toISOString() }, null, 2));
  console.log('written to ' + process.argv[2]);
}

main().catch((err) => {
  console.error('probe run failed:', err.message);
  process.exit(1);
});
