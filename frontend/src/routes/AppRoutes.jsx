import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import CustomerLayout from '../components/layout/CustomerLayout.jsx';
import ProviderLayout from '../components/layout/ProviderLayout.jsx';
import AdminLayout from '../components/layout/AdminLayout.jsx';
import { RequireAuth, RequireRole, RedirectIfAuthenticated } from './guards.jsx';
import { PageLoader } from '../components/ui/Spinner.jsx';
import NotFound from '../pages/NotFound.jsx';

/**
 * The route tree.
 *
 * Split by role so a customer never downloads the admin analytics bundle, and
 * so the three portals can be deployed and reasoned about independently.
 */
const Home = lazy(() => import('../pages/customer/Home.jsx'));

// Auth screens share a chunk: someone who opens one usually opens another.
const About = lazy(() => import('../pages/StaticPages.jsx').then((m) => ({ default: m.About })));
const Help = lazy(() => import('../pages/StaticPages.jsx').then((m) => ({ default: m.Help })));
const ForProviders = lazy(() =>
  import('../pages/StaticPages.jsx').then((m) => ({ default: m.ForProviders })),
);

const Search = lazy(() => import('../pages/customer/Search.jsx'));
const ProviderProfile = lazy(() => import('../pages/customer/ProviderProfile.jsx'));

const BookService = lazy(() => import('../pages/customer/BookService.jsx'));

const MyBookings = lazy(() => import('../pages/customer/MyBookings.jsx'));
const BookingDetail = lazy(() => import('../pages/customer/BookingDetail.jsx'));
const MyReviews = lazy(() => import('../pages/customer/MyReviews.jsx'));
const InvoiceList = lazy(() => import('../pages/customer/Invoices.jsx'));
const InvoiceDetail = lazy(() =>
  import('../pages/customer/Invoices.jsx').then((m) => ({ default: m.InvoiceDetail })),
);

const ProviderDashboard = lazy(() => import('../pages/provider/Dashboard.jsx'));
const ProviderRequests = lazy(() => import('../pages/provider/Requests.jsx'));
const ProviderJobDetail = lazy(() => import('../pages/provider/JobDetail.jsx'));
const ProviderSchedule = lazy(() => import('../pages/provider/Schedule.jsx'));
const ProviderEarnings = lazy(() => import('../pages/provider/Earnings.jsx'));
const ProviderReviews = lazy(() => import('../pages/provider/Reviews.jsx'));
const ProviderProfilePage = lazy(() => import('../pages/provider/Profile.jsx'));
const ProviderVerification = lazy(() => import('../pages/provider/Verification.jsx'));

const AdminDashboard = lazy(() => import('../pages/admin/Dashboard.jsx'));
const AgencyLayout = lazy(() => import('../components/layout/AgencyLayout.jsx'));
const AgencyDashboard = lazy(() => import('../pages/agency/Dashboard.jsx'));
const AgencyTeam = lazy(() => import('../pages/agency/Team.jsx'));
const AgencyJobs = lazy(() => import('../pages/agency/Jobs.jsx'));
const AgencyVerification = lazy(() => import('../pages/agency/Verification.jsx'));
const AgencyProfile = lazy(() => import('../pages/agency/Profile.jsx'));
const AdminReports = lazy(() => import('../pages/admin/Reports.jsx'));
const AdminPeople = lazy(() => import('../pages/admin/People.jsx'));
const AdminVerification = lazy(() => import('../pages/admin/VerificationQueue.jsx'));
const AdminCategories = lazy(() => import('../pages/admin/Categories.jsx'));
const AdminBookings = lazy(() => import('../pages/admin/Bookings.jsx'));
const AdminDisputes = lazy(() => import('../pages/admin/Disputes.jsx'));
const AdminReviews = lazy(() => import('../pages/admin/Reviews.jsx'));
const AdminPayouts = lazy(() => import('../pages/admin/Payouts.jsx'));
const AdminBackup = lazy(() => import('../pages/admin/Backup.jsx'));
const AdminAuditLog = lazy(() => import('../pages/admin/AuditLog.jsx'));
const AdminSettings = lazy(() => import('../pages/admin/Settings.jsx'));

const SignIn = lazy(() => import('../pages/auth/SignIn.jsx'));
const Register = lazy(() => import('../pages/auth/Register.jsx'));
const VerifyAccount = lazy(() => import('../pages/auth/VerifyAccount.jsx'));
const ForgotPassword = lazy(() => import('../pages/auth/ForgotPassword.jsx'));
const Account = lazy(() => import('../pages/auth/Account.jsx'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* ---------- customer and public ---------- */}
        <Route element={<CustomerLayout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          {/* A category page is a pre-filtered search. */}
          <Route path="categories/:slug" element={<Search />} />
          <Route path="providers/:id" element={<ProviderProfile />} />
          <Route path="help" element={<Help />} />
          <Route path="about" element={<About />} />
          <Route path="for-providers" element={<ForProviders />} />

          <Route element={<RequireRole role="customer" />}>
            <Route path="book/:providerId" element={<BookService />} />
            <Route path="bookings" element={<MyBookings />} />
            <Route path="bookings/:id" element={<BookingDetail />} />
            <Route path="invoices" element={<InvoiceList />} />
            <Route path="invoices/:id" element={<InvoiceDetail />} />
            <Route path="reviews" element={<MyReviews />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="account" element={<Account />} />
          </Route>
        </Route>

        {/* ---------- authentication ---------- */}
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="signin" element={<SignIn />} />
          <Route path="register" element={<Register />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
        </Route>
        {/* Not behind RedirectIfAuthenticated: a just-registered user IS signed
            in, and still needs to confirm their contact details. */}
        <Route path="verify" element={<VerifyAccount />} />

        {/* ---------- provider ---------- */}
        <Route element={<RequireRole role="provider" />}>
          <Route path="provider" element={<ProviderLayout />}>
            <Route index element={<ProviderDashboard />} />
            <Route path="requests" element={<ProviderRequests />} />
            <Route path="jobs/:id" element={<ProviderJobDetail />} />
            <Route path="schedule" element={<ProviderSchedule />} />
            <Route path="earnings" element={<ProviderEarnings />} />
            <Route path="reviews" element={<ProviderReviews />} />
            <Route path="profile" element={<ProviderProfilePage />} />
            <Route path="verification" element={<ProviderVerification />} />
          </Route>
        </Route>

        {/* ---------- agency ---------- */}
        <Route element={<RequireRole role="agency" />}>
          <Route path="agency" element={<AgencyLayout />}>
            <Route index element={<AgencyDashboard />} />
            <Route path="team" element={<AgencyTeam />} />
            <Route path="jobs" element={<AgencyJobs />} />
            <Route path="verification" element={<AgencyVerification />} />
            <Route path="profile" element={<AgencyProfile />} />
          </Route>
        </Route>

        {/* ---------- admin ---------- */}
        <Route element={<RequireRole role="admin" />}>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="people" element={<AdminPeople />} />
            <Route path="verification" element={<AdminVerification />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="bookings" element={<AdminBookings />} />
            <Route path="disputes" element={<AdminDisputes />} />
            <Route path="reviews" element={<AdminReviews />} />
            <Route path="payouts" element={<AdminPayouts />} />
            <Route path="backup" element={<AdminBackup />} />
            <Route path="audit" element={<AdminAuditLog />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
