import './globals.css';

export const metadata = {
  title: 'Kindle LLM Token Dashboard',
  description: 'Kindle-friendly LLM token status image generator',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body style={{ margin: 0, overflowX: 'hidden' }}>{children}</body>
    </html>
  );
}
