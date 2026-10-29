/**
 * WhatsApp delivery through Meta's Cloud API.
 *
 * Only authentication-template messages are sent from here. Meta does not
 * permit free-form text to someone who has not messaged you in the last 24
 * hours, and a verification code is by definition the first thing a new
 * customer receives - so an approved template in the Authentication category
 * is the only shape that works. The template owns the wording; this supplies
 * the code.
 *
 * Mirrors the email driver: a console driver for development that logs
 * instead of sending, and the real one chosen by an environment variable.
 */
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import { toE164, maskPhone } from '../../utils/phone.js';

const GRAPH_VERSION = 'v21.0';

/** Prints the message instead of sending it. */
const consoleDriver = {
  name: 'console',
  async send({ to, code }) {
    logger.info(
      { to: maskPhone(to) },
      '[WhatsApp -> ' + maskPhone(to) + '] verification code ' + code,
    );
    return { delivered: true, driver: 'console', messageId: null };
  },
};

/**
 * Meta's Cloud API.
 *
 * The request is deliberately explicit about failure. Meta answers 200 with an
 * error body in some cases and a 4xx in others, so both are checked - a silent
 * success that delivered nothing is the worst outcome here, because the
 * customer waits for a code that is never coming.
 */
const cloudDriver = {
  name: 'cloud',
  async send({ to, code }) {
    const url =
      'https://graph.facebook.com/' + GRAPH_VERSION + '/' +
      env.WHATSAPP_PHONE_NUMBER_ID + '/messages';

    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: env.WHATSAPP_TEMPLATE_NAME,
        language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE },
        components: [
          // The code itself, substituted into the template's body.
          {
            type: 'body',
            parameters: [{ type: 'text', text: String(code) }],
          },
          // A copy-code button needs the code a second time. Templates without
          // one reject this component, so it follows the template's actual
          // shape rather than being sent unconditionally.
          ...(env.WHATSAPP_TEMPLATE_HAS_BUTTON
            ? [{
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: String(code) }],
              }]
            : []),
        ],
      },
    };

    // Times out rather than holding a registration request open indefinitely
    // if Meta is slow - the caller falls back to email on any failure.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let res;
    let payload;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.WHATSAPP_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      payload = await res.json().catch(() => ({}));
    } catch (err) {
      throw new Error(
        err.name === 'AbortError'
          ? 'WhatsApp did not respond within 10 seconds'
          : 'Could not reach WhatsApp: ' + err.message,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok || payload.error) {
      const detail = payload.error?.message ?? ('HTTP ' + res.status);
      const metaCode = payload.error?.code;

      // 132000 is a component or parameter count mismatch, and by far the most
      // common cause is the button: either the template has one and we did not
      // send it, or it has none and we did. Meta's own message names an index,
      // not the problem, so the fix is spelled out here.
      const hint =
        metaCode === 132000
          ? ' - the template components do not match what was sent. If "' +
            env.WHATSAPP_TEMPLATE_NAME + '" has no copy-code button, set ' +
            'WHATSAPP_TEMPLATE_HAS_BUTTON=false; if it has one, set it true.'
          : '';

      throw new Error(
        'WhatsApp refused the message: ' + detail +
        (metaCode ? ' (' + metaCode + ')' : '') + hint,
      );
    }

    const messageId = payload.messages?.[0]?.id ?? null;

    // Accepted is not delivered. Meta queues the message and reports the real
    // outcome on the webhook, so this is logged as "accepted" rather than
    // claiming something that has not happened yet.
    logger.info({ to: maskPhone(to), messageId }, 'WhatsApp accepted the message');

    return { delivered: true, driver: 'cloud', messageId };
  },
};

function driver() {
  return env.WHATSAPP_DRIVER === 'cloud' ? cloudDriver : consoleDriver;
}

/** Whether WhatsApp is configured well enough to be worth attempting. */
export function isConfigured() {
  if (env.WHATSAPP_DRIVER !== 'cloud') return true; // the console driver always works
  return Boolean(
    env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_TEMPLATE_NAME,
  );
}

/**
 * Sends a verification code.
 *
 * Throws on anything that means the customer will not receive it, so the
 * caller can fall back to another channel. Returns the normalised number it
 * actually sent to, which is what gets recorded against the notification.
 */
export async function sendOtp({ phone, code }) {
  const to = toE164(phone);
  if (!to) throw new Error('Not a usable mobile number: ' + phone);

  if (!isConfigured()) {
    throw new Error('WhatsApp is not configured - set WHATSAPP_PHONE_NUMBER_ID, ' +
      'WHATSAPP_ACCESS_TOKEN and WHATSAPP_TEMPLATE_NAME');
  }

  const result = await driver().send({ to, code });
  return { ...result, to };
}

/** True when the code may be echoed in an API response - development only. */
export function codeCanBeEchoed() {
  return env.WHATSAPP_DRIVER === 'console' && !env.isProd;
}

export default { sendOtp, isConfigured, codeCanBeEchoed };
