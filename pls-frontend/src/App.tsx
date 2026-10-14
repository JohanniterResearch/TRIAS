import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import { setSessionExpiredHandler } from './api/client';

const queryClient = new QueryClient();

setSessionExpiredHandler((loginPath) => void router.navigate(loginPath, { replace: true }));

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export default App;
