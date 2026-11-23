import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[70] bg-warning/10 border-b border-warning/30 px-4 py-2.5 text-center" role="alert">
      <div className="flex items-center justify-center gap-2 text-sm font-medium text-warning">
        <WifiOff className="h-4 w-4" />
        You&rsquo;re offline. Show your order to staff.
      </div>
    </div>
  );
}
