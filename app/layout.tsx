import './globals.css';
import './library-panel.css';
import './research-panel.css';
import './shortcuts-panel.css';
import './research-os-theme.css';
import './wallpaper/wallpaper.css';
import './chocomint-theme.css';

export const metadata = {
  title: 'Chocomint Lab',
  description: 'Research Workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
