import './globals.css';
import './library-panel.css';
import './research-panel.css';
import './shortcuts-panel.css';
import './research-os-theme.css';
import './wallpaper/wallpaper.css';
import './chocomint-theme.css';
import { ResolutionSync } from './resolution-sync';

export const metadata = {
  title: 'Chocomint Lab',
  description: 'Research Workspace · 개인 연구 작업실',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <ResolutionSync />
        {children}
      </body>
    </html>
  );
}
