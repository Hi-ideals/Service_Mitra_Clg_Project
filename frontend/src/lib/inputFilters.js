/**
 * Filters that keep a field to what it is for, as it is typed.
 *
 * These wrap what `register()` returns rather than replacing it, so the
 * validation rules declared on the field still run exactly as before - this
 * only changes what is allowed to reach them.
 *
 * Filtering on the way in rather than complaining afterwards is the point. A
 * field that silently refuses a letter teaches the rule immediately; one that
 * accepts it and reports "enter a valid phone number" on submit teaches it
 * after the fact, when the person has moved on.
 */

/**
 * Digits only, up to `max` of them.
 *
 * Non-digits are refused as they arrive rather than deleted afterwards.
 *
 * That ordering is not stylistic. Rewriting `event.target.value` inside the
 * change handler leaves React's internal value tracker holding the old string,
 * and the next input event producing that same value is then discarded as a
 * no-op - so typing "98a7b654321099" quickly lost real digits, not merely the
 * letters. Refusing the input means the value is never wrong, so it never has
 * to be rewritten.
 *
 * `beforeinput` rather than `keydown` because it covers every way text can
 * arrive - typing, pasting, autofill, drag-and-drop, an IME - where keydown
 * covers only one of them.
 *
 * The change handler below stays as a net for anything that still slips
 * through, which is harmless there: it only runs when the value is already
 * wrong, and nothing is being typed behind it to lose.
 */
export function phoneDigits(field, max = 10) {
  return {
    ...field,
    maxLength: max,

    onBeforeInput: (event) => {
      // `data` is null for deletions and for the composition events that
      // bracket IME input. Only inserted text is checked.
      if (typeof event.data !== 'string') return;

      // A single digit is the overwhelmingly common case - someone typing.
      // Nothing to clean, so it goes in natively.
      if (/^\d$/.test(event.data)) return;

      // Anything longer arrived in one go: a paste, an autofill, a phone
      // keyboard's suggestion. Rejecting it outright would throw away
      // "+91 98765 43210" entirely, so the number inside it is recovered.
      const digits = withoutTrunkPrefix(event.data.replace(/\D/g, ''), max);
      if (digits === event.data) return;

      event.preventDefault();
      if (!digits) return;

      // execCommand keeps the caret where it belongs and leaves undo working,
      // which assigning to .value does not. It raises its own input event, so
      // the form hears about the change exactly as if it had been typed.
      document.execCommand('insertText', false, digits);
    },

    onChange: (event) => {
      const cleaned = event.target.value.replace(/\D/g, '').slice(0, max);
      if (event.target.value !== cleaned) event.target.value = cleaned;
      return field.onChange(event);
    },
  };
}

/**
 * Drops a country code or trunk prefix from a pasted number.
 *
 * Without this, pasting "+91 98765 43210" kept the first ten digits of
 * "919876543210" and produced 9198765432 - a different number, ten digits
 * long, which passes every validation rule there is. A wrong number that looks
 * right is worse than a rejected one: nobody sees it, and the professional
 * turns up unable to call.
 *
 * Only applied when there are more digits than the field holds, so a number
 * that genuinely begins 91 is never touched.
 */
function withoutTrunkPrefix(digits, max) {
  if (digits.length <= max) return digits;

  // 91 is India's country code; a single leading 0 is the domestic trunk
  // prefix people still write out of habit.
  return digits.replace(/^(?:91|0)(?=\d{10}$)/, '').slice(0, max);
}

/**
 * The same cap, but only when the field is being used as a phone number.
 *
 * The sign-in field takes an email address or a phone number, and it cannot
 * know which until it sees one. So anything containing a non-digit is left
 * entirely alone - truncating an email at ten characters would be a far worse
 * bug than the one this prevents.
 *
 * No keystroke filtering here for the same reason: the first character of
 * "9876543210@example.com" is a digit, and a field that refused the @ would be
 * unusable for exactly the people it is meant to help.
 */
export function digitsOnlyIfNumeric(field, max = 10) {
  return {
    ...field,
    onChange: (event) => {
      const value = event.target.value;
      if (/^\d+$/.test(value) && value.length > max) {
        event.target.value = withoutTrunkPrefix(value, max);
      }
      return field.onChange(event);
    },
  };
}

export default { phoneDigits, digitsOnlyIfNumeric };
