import { useState, useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { checkAdminSession, isAuthenticated } from '../../lib/auth';
import Skeleton from '../ui/Skeleton';

export default function AdminAuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(isAuthenticated());

  useEffect(() => {
    let mounted = true;
    async function verify() {
      const valid = await checkAdminSession();
      if (mounted) {
        setAuthorized(valid);
        setChecking(false);
      }
    }
    verify();
    return () => {
      mounted = false;
    };
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <Skeleton className="h-10 w-10 rounded-full mb-4" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (!authorized) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
