import './globals.css';

export const metadata = {
  title: 'Master Thesis OS',
  description: 'Research dashboard for necessary labour thesis',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
