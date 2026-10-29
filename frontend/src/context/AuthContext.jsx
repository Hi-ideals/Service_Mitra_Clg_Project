/**
 * Who is signed in.
 *
 * This is the one piece of genuinely global client state. Everything else the
 * API returns lives in React Query, not here - copying server data into
 * Context is how two parts of a screen end up disagreeing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setAccessToken, setUnauthenticatedHandler, refreshSession } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Distinguishes "we have not checked yet" from "checked, nobody is here" -
  // without it, every protected route flashes the sign-in page on reload.
  const [isRestoring, setIsRestoring] = useState(true);
  const queryClient = useQueryClient();

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  /**
   * On a page load there is no access token in memory, but the refresh cookie
   * may still be valid - so the session is restored silently before anything
   * renders a redirect.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const restored = await refreshSession();
      if (cancelled) return;
      if (restored?.user) setUser(restored.user);
      setIsRestoring(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // When a refresh finally fails, the API client tells us to drop the session.
  useEffect(() => {
    setUnauthenticatedHandler(() => clearSession());
    return () => setUnauthenticatedHandler(null);
  }, [clearSession]);

  /**
   * Signs in, or stops half way.
   *
   * An account with two-factor authentication gets no session from the
   * password alone - what comes back is a short-lived challenge token and
   * nothing else. The caller is told so and sends the code to `completeSignIn`.
   */
  const signIn = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login', credentials, { skipRefresh: true });

    // An admin who has never enrolled. No session was issued - only a token
    // good for finishing the setup - so the screen has to carry them through
    // it before anything else can happen.
    if (data.twoFactorSetupRequired) {
      return {
        twoFactorSetupRequired: true,
        setupToken: data.setupToken,
        secret: data.secret,
        otpauthUri: data.otpauthUri,
      };
    }

    if (data.twoFactorRequired) {
      return { twoFactorRequired: true, challengeToken: data.challengeToken };
    }

    setAccessToken(data.accessToken);
    setUser(data.user);
    return { user: data.user };
  }, []);

  const enrolAndSignIn = useCallback(async ({ setupToken, code }) => {
    const { data } = await api.post(
      '/auth/login/2fa/enrol', { setupToken, code }, { skipRefresh: true },
    );
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  }, []);

  const completeSignIn = useCallback(async ({ challengeToken, code }) => {
    const { data } = await api.post(
      '/auth/login/2fa', { challengeToken, code }, { skipRefresh: true },
    );
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  }, []);

  /**
   * Creates the account. Does not sign anyone in.
   *
   * There is no session to store yet - the server issues one only when the
   * code is confirmed, which is what `confirmAccount` below does.
   */
  const register = useCallback(async (payload) => {
    const { data } = await api.post('/auth/register', payload, { skipRefresh: true });
    return data;
  }, []);

  /** Confirms the code, and that is what hands over the session. */
  const confirmAccount = useCallback(async ({ destination, code }) => {
    const { data } = await api.post(
      '/auth/otp/verify', { destination, code }, { skipRefresh: true },
    );
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // A failed logout call must still clear the session locally.
    }
    clearSession();
  }, [clearSession]);

  /** Refreshes the cached user after a profile change or KYC decision. */
  const reloadUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      isRestoring,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,
      isCustomer: user?.role === 'customer',
      isProvider: user?.role === 'provider',
      isAdmin: user?.role === 'admin',
      isAgency: user?.role === 'agency',
      // A provider can sign in and build a profile while unverified, so the
      // UI needs this separately from "is signed in".
      isVerifiedProvider: user?.role === 'provider' && user?.verificationStatus === 'approved',
      // An agency can sign in and add people while unverified; none of them
      // are bookable until this is true.
      isVerifiedAgency: user?.role === 'agency' && user?.verificationStatus === 'approved',
      signIn,
      completeSignIn,
      confirmAccount,
      enrolAndSignIn,
      register,
      signOut,
      reloadUser,
      setUser,
    }),
    [user, isRestoring, signIn, completeSignIn, enrolAndSignIn, confirmAccount, register, signOut, reloadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

export default AuthContext;
