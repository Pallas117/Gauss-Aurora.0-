import { RouterProvider } from 'react-router';
import { router } from './routes';
import { ThemeProvider } from './components/theme-provider';

function App() {
  return (
    <ThemeProvider defaultTheme="dark" attribute="class" enableSystem={false} disableTransitionOnChange>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

export default App;
