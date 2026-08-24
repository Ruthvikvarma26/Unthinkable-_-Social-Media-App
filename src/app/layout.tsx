import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Social Media Content Analyzer',
  description: 'Analyze social media posts and suggest engagement improvements.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main className="container" style={{ minHeight: '100vh', padding: '2rem 1.5rem' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
