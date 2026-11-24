import React, { useEffect } from 'react';
import { RouterProvider, useRouter } from './lib/router.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { ToastProvider } from './context/ToastContext.tsx';
import { StorefrontPage } from './pages/StorefrontPage.tsx';
import { ShopAdminPage } from './pages/ShopAdminPage.tsx';
import { SuperAdminPage } from './pages/SuperAdminPage.tsx';
import { AuthPanel } from './pages/AuthPanel.tsx';
import { OfflineBanner } from './components/PWAInstallButton.tsx';

function AppRoutes() {
  const { pathname, navigate } = useRouter();

  const segments = pathname.split('/').filter(Boolean);

  // Default root "/" lands directly on the pilot storefront "/mam"
  useEffect(() => {
    if (segments.length === 0) {
      navigate('/mam', { replace: true });
    }
  }, [segments.length, navigate]);

  if (segments.length === 0) {
    return <StorefrontPage slug="mam" />;
  }

  if (segments[0] === 'login') {
    return <AuthPanel />;
  }

  if (segments[0] === 'admin') {
    return <ShopAdminPage />;
  }

  if (segments[0] === 'super-admin') {
    return <SuperAdminPage />;
  }

  const slug = segments[0];
  return <StorefrontPage slug={slug} />;
}

export default function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
          <OfflineBanner />
        </ToastProvider>
      </AuthProvider>
    </RouterProvider>
  );
}
