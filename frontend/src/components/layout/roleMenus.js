import { User } from 'lucide-react';

/**
 * What the menu under somebody's name offers, per role.
 *
 * Only the account page, and sign out below it.
 *
 * Everything else a professional or an agency does already has a tab in the
 * navigation bar beside the logo - repeating Dashboard, Requests and Earnings
 * in a dropdown directly underneath them said the same thing twice. The
 * account page is the exception worth carrying, because it is shared by every
 * role and so appears in nobody's navigation bar.
 *
 * Kept in one file rather than in each layout: the same person sees this menu
 * inside their own area and again on the shared account page, and the two
 * drifted apart once already.
 */
const ACCOUNT_ONLY = [{ to: '/account', label: 'My account', icon: User }];

export const ROLE_MENUS = {
  provider: ACCOUNT_ONLY,
  agency: ACCOUNT_ONLY,
  admin: ACCOUNT_ONLY,
};

export default ROLE_MENUS;
