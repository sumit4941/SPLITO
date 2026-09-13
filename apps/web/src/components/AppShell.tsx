import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, SplitoLogo, StatusBadge, cn } from '@splito/ui';
import {
  Activity,
  BarChart3,
  Bell,
  CloudOff,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  MoonStar,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Users,
  WalletCards,
  Wifi,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ApiError, api, friendlyApiError } from '../api/client';
import { clearOfflineAccount } from '../lib/offline';
import { captureGroupInvitationToken, safeInternalDestination } from '../lib/invitations';
import { useTheme } from '../providers/ThemeProvider';
import { OfflineSyncBridge } from './OfflineSyncBridge';
import { Avatar } from './PageElements';

const navigation = [
  { labelKey: 'nav.dashboard', to: '/', icon: LayoutDashboard, end: true },
  { labelKey: 'nav.groups', to: '/groups', icon: WalletCards, end: false },
  { labelKey: 'nav.friends', to: '/friends', icon: Users, end: false },
  { labelKey: 'nav.activity', to: '/activity', icon: Activity, end: false },
  { labelKey: 'nav.analytics', to: '/analytics', icon: BarChart3, end: false },
  { labelKey: 'nav.settings', to: '/settings', icon: Settings, end: false },
] as const;

const routeTitles: Array<[RegExp, string, string]> = [
  [/^\/$/, 'Your orbit', 'A clear view of what you owe and what comes back to you.'],
  [/^\/groups\/[^/]+$/, 'Group details', 'Expenses, balances, people, and activity in one place.'],
  [/^\/groups$/, 'Groups', 'Every shared context stays separate and reconcilable.'],
  [/^\/join$/, 'Join group', 'Review and accept a phone-bound invitation.'],
  [/^\/friends$/, 'People', 'Friends and guests you share expenses with.'],
  [/^\/expenses\/new$/, 'New expense', 'Record who paid and how the cost should be shared.'],
  [/^\/expenses\//, 'Expense', 'The authoritative expense record and its current status.'],
  [/^\/settle$/, 'Settle up', 'Record a manual payment assertion between participants.'],
  [/^\/analytics$/, 'Analytics', 'Understand spending without mixing currencies.'],
  [/^\/activity$/, 'Activity', 'An auditable view of changes that affect you.'],
  [/^\/search$/, 'Search', 'Find authorized expenses without exposing private records.'],
  [/^\/recurring$/, 'Recurring expenses', 'Manage schedules and independent occurrences.'],
  [/^\/receipts$/, 'Receipts', 'Review private uploads and extraction progress.'],
  [/^\/settings\/security$/, 'Security', 'Sessions, passkeys, MFA, and recovery.'],
  [/^\/settings$/, 'Settings', 'Profile, preferences, privacy, and data controls.'],
  [/^\/offline$/, 'Offline work', 'Drafts and queued changes stored on this device.'],
];

function useOnlineState() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const online = useOnlineState();
  const prefersReducedMotion = useReducedMotion();
  const { preference, setPreference, reducedMotion } = useTheme();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [capturedInviteLocation, setCapturedInviteLocation] = useState<string>();
  const userQuery = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false });
  const inviteLocationKey =
    location.pathname === '/join' && location.hash.includes('invite=')
      ? `${location.key}:${location.hash}`
      : undefined;
  const needsInviteCapture = Boolean(
    inviteLocationKey && capturedInviteLocation !== inviteLocationKey,
  );
  const routeHeading = useMemo(() => {
    const match = routeTitles.find(([pattern]) => pattern.test(location.pathname));
    return match
      ? { title: match[1], description: match[2] }
      : { title: 'SPLITO', description: 'Shared money in balance.' };
  }, [location.pathname]);

  useEffect(() => setMobileMenu(false), [location.pathname]);
  useLayoutEffect(() => {
    if (!needsInviteCapture || !inviteLocationKey) return;
    captureGroupInvitationToken();
    setCapturedInviteLocation(inviteLocationKey);
  }, [inviteLocationKey, needsInviteCapture]);

  const cycleTheme = () => {
    setPreference(preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light');
  };

  const logout = async () => {
    const accountId = userQuery.data?.id;
    let serverRevoked = true;
    try {
      await api.logout();
    } catch {
      serverRevoked = false;
    } finally {
      if (accountId) await clearOfflineAccount(accountId);
      queryClient.clear();
      window.location.assign(serverRevoked ? '/login?logout=complete' : '/login?logout=local-only');
    }
  };

  if (userQuery.isLoading || needsInviteCapture) {
    return (
      <main className="protected-gate" aria-live="polite">
        <div className="protected-gate__mark">
          <SplitoLogo compact />
          <span aria-hidden="true" />
        </div>
        <h1>Opening your orbit</h1>
        <p>Checking your secure session before loading financial data…</p>
      </main>
    );
  }

  if (userQuery.error instanceof ApiError && userQuery.error.status === 401) {
    const destination = safeInternalDestination(
      location.pathname === '/join'
        ? `${location.pathname}${location.search}`
        : `${location.pathname}${location.search}${location.hash}`,
    );
    return <Navigate replace state={{ from: destination }} to="/login" />;
  }

  if (userQuery.error || !userQuery.data) {
    return (
      <main className="protected-gate protected-gate--error">
        <SplitoLogo />
        <ErrorState
          action={
            <Button icon={RefreshCw} onClick={() => void userQuery.refetch()}>
              Try again
            </Button>
          }
          description={friendlyApiError(userQuery.error)}
          title="Your session could not be checked"
        />
        <p>Protected financial views stay closed until your access is confirmed.</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div aria-hidden="true" className="ambient ambient--one" />
      <div aria-hidden="true" className="ambient ambient--two" />
      <OfflineSyncBridge accountId={userQuery.data?.id} />

      <aside
        className={cn('sidebar', mobileMenu && 'sidebar--open')}
        aria-label="Primary navigation"
      >
        <div className="sidebar__brand">
          <Link aria-label="SPLITO overview" to="/">
            <SplitoLogo />
          </Link>
          <button
            aria-label="Close navigation"
            className="sidebar__close"
            onClick={() => setMobileMenu(false)}
            type="button"
          >
            <X />
          </button>
        </div>
        <nav className="sidebar__nav">
          {navigation.map(({ end, icon: Icon, labelKey, to }) => (
            <NavLink
              className={({ isActive }) => cn('nav-link', isActive && 'nav-link--active')}
              end={end}
              key={to}
              to={to}
            >
              <Icon aria-hidden="true" size={19} />
              <span>{t(labelKey)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__actions">
          <Button asChild icon={Plus} size="lg">
            <Link to="/expenses/new">{t('actions.addExpense')}</Link>
          </Button>
          <Button asChild icon={WalletCards} variant="secondary">
            <Link to="/settle">{t('actions.settle')}</Link>
          </Button>
        </div>
        <div className="sidebar__foot">
          <NavLink className="offline-link" to="/offline">
            {online ? (
              <Wifi aria-hidden="true" size={17} />
            ) : (
              <CloudOff aria-hidden="true" size={17} />
            )}
            <span>{online ? 'Online · sync enabled' : 'Offline · changes stay local'}</span>
          </NavLink>
          <p>Private device data is cleared at logout.</p>
        </div>
      </aside>
      {mobileMenu && (
        <button
          aria-label="Close navigation overlay"
          className="sidebar-scrim"
          onClick={() => setMobileMenu(false)}
          type="button"
        />
      )}

      <div className="app-column">
        <header className="topbar">
          <button
            aria-label="Open navigation"
            className="icon-control topbar__menu"
            onClick={() => setMobileMenu(true)}
            type="button"
          >
            <Menu />
          </button>
          <div className="topbar__heading">
            <p>{routeHeading.title}</p>
            <span>{routeHeading.description}</span>
          </div>
          <div className="topbar__actions">
            {!online && (
              <StatusBadge tone="warning">
                <CloudOff aria-hidden="true" size={13} />
                Offline
              </StatusBadge>
            )}
            <Link aria-label="Search expenses" className="icon-control" to="/search">
              <Search />
            </Link>
            <button
              aria-label={`Theme: ${preference}. Change theme`}
              className="icon-control"
              onClick={cycleTheme}
              title={`Theme: ${preference}`}
              type="button"
            >
              {preference === 'dark' ? <MoonStar /> : <Sun />}
            </button>
            <Link
              aria-label="Notifications and activity"
              className="icon-control topbar__optional"
              to="/activity"
            >
              <Bell />
            </Link>
            {userQuery.data ? (
              <div
                className="account-chip"
                title={
                  userQuery.data.email ?? userQuery.data.mobileNumber ?? userQuery.data.displayName
                }
              >
                <Link
                  aria-label={`View profile for ${userQuery.data.displayName}`}
                  className="account-chip__profile"
                  to="/settings"
                >
                  <Avatar participant={userQuery.data} size="sm" />
                  <div>
                    <strong>{userQuery.data.displayName}</strong>
                    <small>View profile</small>
                  </div>
                </Link>
                <button aria-label="Sign out" onClick={() => void logout()} type="button">
                  <LogOut aria-hidden="true" size={16} />
                </button>
              </div>
            ) : (
              <Button asChild icon={LogIn} size="sm" variant="secondary">
                <Link to="/login">Sign in</Link>
              </Button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.main
            animate={{ opacity: 1, y: 0 }}
            className="page"
            exit={{ opacity: 0, y: reducedMotion || prefersReducedMotion ? 0 : -6 }}
            id="main-content"
            initial={{ opacity: 0, y: reducedMotion || prefersReducedMotion ? 0 : 8 }}
            key={location.pathname}
            transition={{
              duration: reducedMotion || prefersReducedMotion ? 0 : 0.22,
              ease: [0.2, 0.8, 0.2, 1],
            }}
          >
            <Outlet />
          </motion.main>
        </AnimatePresence>
      </div>

      <nav aria-label="Mobile navigation" className="bottom-nav">
        {navigation.slice(0, 4).map(({ end, icon: Icon, labelKey, to }) => (
          <NavLink
            className={({ isActive }) =>
              cn('bottom-nav__link', isActive && 'bottom-nav__link--active')
            }
            end={end}
            key={to}
            to={to}
          >
            <Icon aria-hidden="true" size={21} />
            <span>{t(labelKey).replace('People', 'People')}</span>
          </NavLink>
        ))}
        <NavLink aria-label="Add expense" className="bottom-nav__add" to="/expenses/new">
          <Plus aria-hidden="true" size={25} />
        </NavLink>
      </nav>
    </div>
  );
}
