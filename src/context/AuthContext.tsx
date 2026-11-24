import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../shared/types.ts';
import { api, setAccessToken } from '../lib/api.ts';

interface AuthContextValue {
  user: AuthUser | null;
  needsBootstrap: boolean;
  hasShopAdmin: boolean;
  hasSuperAdmin: boolean;
  loadingStatus: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  bootstrap: (params: {
    superAdminEmail: string;
    superAdminPassword: string;
    shopOwnerEmail?: string;
    shopOwnerPassword?: string;
    loginAs: 'shop_owner' | 'super_admin';
  }) => Promise<AuthUser>;
  logout: () => void;
  refreshStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [hasShopAdmin, setHasShopAdmin] = useState(false);
  const [hasSuperAdmin, setHasSuperAdmin] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const status = await api.getAuthStatus();
      setNeedsBootstrap(status.needsBootstrap);
      setHasShopAdmin(status.hasShopAdmin);
      setHasSuperAdmin(status.hasSuperAdmin);
    } catch {
      // Ignore transient error
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setAccessToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const bootstrap = useCallback(
    async (params: {
      superAdminEmail: string;
      superAdminPassword: string;
      shopOwnerEmail?: string;
      shopOwnerPassword?: string;
      loginAs: 'shop_owner' | 'super_admin';
    }) => {
      const res = await api.bootstrapAuth(params);
      setAccessToken(res.token);
      setUser(res.user);
      setNeedsBootstrap(false);
      setHasSuperAdmin(true);
      if (params.shopOwnerEmail) setHasShopAdmin(true);
      return res.user;
    },
    []
  );

  const logout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      needsBootstrap,
      hasShopAdmin,
      hasSuperAdmin,
      loadingStatus,
      login,
      bootstrap,
      logout,
      refreshStatus,
    }),
    [
      user,
      needsBootstrap,
      hasShopAdmin,
      hasSuperAdmin,
      loadingStatus,
      login,
      bootstrap,
      logout,
      refreshStatus,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
