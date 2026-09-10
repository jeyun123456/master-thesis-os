import './globals.css';
import './library-panel.css';
import './research-panel.css';
import './shortcuts-panel.css';

export const metadata = {
  title: 'Master Thesis OS',
  description: '한국 필요노동 석사논문 연구 작업실',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
