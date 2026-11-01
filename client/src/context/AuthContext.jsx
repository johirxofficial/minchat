import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { endpoints, setCsrfToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [me, setMeState] = useState(null);
  const [loading, setLoading] = useState(true);

  const adopt = useCallback((data) => {
    setCsrfToken(data?.csrfToken ?? null);
    setMeState(data ?? null);
    return data;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await endpoints.me();
      return adopt(data);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        adopt(null);
        return null;
      }
      throw err;
    }
  }, [adopt]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await endpoints.me();
        if (!cancelled) adopt(data);
      } catch {
        if (!cancelled) adopt(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  useEffect(() => {
    const onUnauthorized = () => {
      setMeState(null);
      setCsrfToken(null);
    };
    window.addEventListener('minchat:unauthorized', onUnauthorized);
    return () => window.removeEventListener('minchat:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(
    async (identifier, password) => {
      const data = await endpoints.login(identifier, password);
      return adopt(data);
    },
    [adopt]
  );

  const register = useCallback(
    async (payload) => {
      const data = await endpoints.register(payload);
      // A deployment that requires email verification returns 202 without a
      // session; keep the visitor signed out and let the page explain why.
      if (data?.verificationRequired) return data;
      return adopt(data);
    },
    [adopt]
  );

  const logout = useCallback(async () => {
    try {
      await endpoints.logout();
    } catch {
      // Session may already be gone; clearing local state is still correct.
    }
    adopt(null);
  }, [adopt]);

  const updateLocal = useCallback((updater) => {
    setMeState((current) => (typeof updater === 'function' ? updater(current) : updater));
  }, []);

  const can = useCallback(
    (capability) => Boolean(me?.user?.capabilities?.includes(capability)),
    [me]
  );

  const value = useMemo(
    () => ({
      me,
      user: me?.user ?? null,
      loading,
      isAdmin: me?.user?.role === 'admin',
      isStaff: Boolean(me?.user?.capabilities?.includes('console.access')),
      can,
      login,
      register,
      logout,
      refresh,
      setMe: adopt,
      updateLocal
    }),
    [me, loading, can, login, register, logout, refresh, adopt, updateLocal]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
