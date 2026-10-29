import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient.js';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Toaster from './components/ui/Toaster.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import AppRoutes from './routes/AppRoutes.jsx';

/**
 * Provider order matters: AuthProvider calls useQueryClient to clear the cache
 * on sign-out, so it has to sit inside QueryClientProvider.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <ScrollToTop />
              <AppRoutes />
              <Toaster />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
