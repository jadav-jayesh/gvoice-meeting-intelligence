import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { App } from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireAdmin } from "./auth/RequireAdmin";
import { RedirectIfAuthed } from "./auth/RedirectIfAuthed";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminAnalyticsPage } from "./pages/admin/AdminAnalyticsPage";
import { AdminSettingsPage } from "./pages/admin/AdminSettingsPage";
import { LandingPage } from "./pages/LandingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MeetingsListPage } from "./pages/MeetingsListPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { InsightsPage } from "./pages/InsightsPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { ProfilePage } from "./pages/ProfilePage";
import { CalendarsPage } from "./pages/CalendarsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { SettingsLayout } from "./pages/SettingsLayout";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { TermsPage } from "./pages/TermsPage";
import { SharedMeetingPage } from "./pages/SharedMeetingPage";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
          {/* Public marketing landing page — open to everyone */}
          <Route path="/" element={<LandingPage />} />

          {/* Public legal pages — open to everyone */}
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsPage />} />

          {/* Public shared meeting — anyone with the link, no login */}
          <Route path="/share/:token" element={<SharedMeetingPage />} />

          {/* Public auth pages — no app shell, redirect away if already signed in */}
          <Route element={<RedirectIfAuthed />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>

          {/* Everything below requires auth and shares the main app shell —
              Super Admin pages included, so the sidebar never swaps out. */}
          <Route element={<RequireAuth />}>
            <Route element={<App />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="meetings" element={<MeetingsListPage />} />
              <Route path="meetings/:sessionId" element={<MeetingDetailPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="/settings/profile" replace />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="calendars" element={<CalendarsPage />} />
              </Route>

              {/* Super Admin — extra role gate beyond the sidebar's own check,
                  so a typed-in URL still can't reach these for non-admins. */}
              <Route element={<RequireAdmin />}>
                <Route path="admin" element={<Navigate to="/admin/analytics" replace />} />
                <Route path="admin/users" element={<AdminUsersPage />} />
                <Route path="admin/analytics" element={<AdminAnalyticsPage />} />
                <Route path="admin/settings" element={<AdminSettingsPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
