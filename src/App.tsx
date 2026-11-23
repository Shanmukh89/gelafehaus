import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import Skeleton from './components/ui/Skeleton';

// Customer Pages
const WelcomePage = lazy(() => import('./pages/customer/WelcomePage'));
const MenuPage = lazy(() => import('./pages/customer/MenuPage'));
const CheckoutPage = lazy(() => import('./pages/customer/CheckoutPage'));
const ConfirmationPage = lazy(() => import('./pages/customer/ConfirmationPage'));

// Admin Pages
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const AdminAuthGuard = lazy(() => import('./components/admin/AdminAuthGuard'));
const AdminLoginPage = lazy(() => import('./pages/admin/AdminLoginPage'));
const OrdersPage = lazy(() => import('./pages/admin/OrdersPage'));
const MenuManagerPage = lazy(() => import('./pages/admin/MenuManagerPage'));
const TodayPage = lazy(() => import('./pages/admin/TodayPage'));

function PageFallback() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="h-12 w-12 rounded-full mx-auto" />
        <Skeleton className="h-6 w-48 mx-auto" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Customer routes */}
            <Route path="/" element={<WelcomePage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/confirmation" element={<ConfirmationPage />} />

            {/* Admin Authentication */}
            <Route path="/admin/login" element={<AdminLoginPage />} />

            {/* Admin Management routes */}
            <Route
              path="/admin"
              element={
                <AdminAuthGuard>
                  <AdminLayout />
                </AdminAuthGuard>
              }
            >
              <Route index element={<OrdersPage />} />
              <Route path="menu" element={<MenuManagerPage />} />
              <Route path="today" element={<TodayPage />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  );
}
