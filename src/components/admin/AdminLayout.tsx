import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ClipboardList, UtensilsCrossed, BarChart3, Volume2, VolumeX, LogOut, ExternalLink } from 'lucide-react';
import { soundAlert } from '../../lib/sound';
import { setAuthenticated } from '../../lib/auth';
import OfflineBanner from '../ui/OfflineBanner';

export default function AdminLayout() {
  const [soundOn, setSoundOn] = useState(soundAlert.enabled);
  const navigate = useNavigate();

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    soundAlert.setEnabled(next);
    if (next) soundAlert.playChime();
  }

  function handleLogout() {
    setAuthenticated(false);
    navigate('/admin/login');
  }

  const navItems = [
    { to: '/admin', end: true, label: 'Orders', icon: ClipboardList },
    { to: '/admin/menu', label: 'Menu Manager', icon: UtensilsCrossed },
    { to: '/admin/today', label: 'Today', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      <OfflineBanner />

      {/* ─── Sidebar (Desktop) / Topbar (Tablet & Mobile) ─── */}
      <aside className="bg-sidebar text-white shrink-0 lg:w-64 flex flex-col lg:min-h-screen border-b lg:border-b-0 lg:border-r border-sidebar-hover z-20">
        {/* Brand & Global Controls */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-sidebar-hover">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-[8px] bg-primary flex items-center justify-center font-heading font-black text-white text-lg">
              G
            </div>
            <div>
              <span className="font-heading font-bold text-base text-white tracking-tight block leading-tight">
                Gelafehaus
              </span>
              <span className="text-[10px] text-white/50 tracking-wider uppercase font-semibold block">
                Kitchen & Admin
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Sound Toggle */}
            <button
              onClick={toggleSound}
              className="h-11 w-11 rounded-[var(--radius-input)] flex items-center justify-center text-white/70 hover:text-white hover:bg-sidebar-hover transition-colors cursor-pointer"
              title={soundOn ? 'Sound alerts enabled' : 'Sound alerts muted'}
              aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
            >
              {soundOn ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex lg:flex-col overflow-x-auto lg:overflow-visible p-2 lg:p-4 gap-1 flex-1">
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-input)] text-sm font-medium
                  whitespace-nowrap transition-colors duration-150 cursor-pointer
                  ${isActive
                    ? 'bg-sidebar-active text-white shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-sidebar-hover'
                  }
                `}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer controls */}
        <div className="hidden lg:flex flex-col p-4 border-t border-sidebar-hover gap-1">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-input)] text-xs text-white/60 hover:text-white hover:bg-sidebar-hover transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open Customer App</span>
          </a>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-input)] text-xs text-danger/80 hover:text-danger hover:bg-sidebar-hover transition-colors cursor-pointer w-full text-left"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ─── Main Content Area ─── */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
