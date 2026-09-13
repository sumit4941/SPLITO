import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from '@splito/ui';
import { AppShell } from './components/AppShell';

const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const GroupsPage = lazy(() =>
  import('./pages/GroupsPage').then((module) => ({ default: module.GroupsPage })),
);
const GroupDetailPage = lazy(() =>
  import('./pages/GroupsPage').then((module) => ({ default: module.GroupDetailPage })),
);
const JoinGroupPage = lazy(() =>
  import('./pages/JoinGroupPage').then((module) => ({ default: module.JoinGroupPage })),
);
const ExpenseComposerPage = lazy(() =>
  import('./pages/ExpensesPage').then((module) => ({ default: module.ExpenseComposerPage })),
);
const ExpenseDetailPage = lazy(() =>
  import('./pages/ExpensesPage').then((module) => ({ default: module.ExpenseDetailPage })),
);
const SettlementPage = lazy(() =>
  import('./pages/SettlementPage').then((module) => ({ default: module.SettlementPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const SecurityPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SecurityPage })),
);
const OfflinePage = lazy(() =>
  import('./pages/OfflinePage').then((module) => ({ default: module.OfflinePage })),
);
const FriendsPage = lazy(() =>
  import('./pages/SecondaryPages').then((module) => ({ default: module.FriendsPage })),
);
const ActivityPage = lazy(() =>
  import('./pages/SecondaryPages').then((module) => ({ default: module.ActivityPage })),
);
const SearchPage = lazy(() =>
  import('./pages/SecondaryPages').then((module) => ({ default: module.SearchPage })),
);
const RecurringPage = lazy(() =>
  import('./pages/SecondaryPages').then((module) => ({ default: module.RecurringPage })),
);
const ReceiptsPage = lazy(() =>
  import('./pages/SecondaryPages').then((module) => ({ default: module.ReceiptsPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
);

export function App() {
  return (
    <Suspense fallback={<LoadingState label="Opening SPLITO…" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/welcome" element={<Navigate replace to="/login" />} />
        <Route path="/register" element={<Navigate replace to="/login" />} />
        <Route path="/password-reset" element={<Navigate replace to="/login" />} />
        <Route path="/verify-email" element={<Navigate replace to="/login" />} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="groups/:groupId" element={<GroupDetailPage />} />
          <Route path="join" element={<JoinGroupPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="expenses/new" element={<ExpenseComposerPage />} />
          <Route path="expenses/:expenseId/edit" element={<ExpenseComposerPage />} />
          <Route path="expenses/:expenseId" element={<ExpenseDetailPage />} />
          <Route path="settle" element={<SettlementPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="recurring" element={<RecurringPage />} />
          <Route path="receipts" element={<ReceiptsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/security" element={<SecurityPage />} />
          <Route path="offline" element={<OfflinePage />} />
          <Route path="home" element={<Navigate replace to="/" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
