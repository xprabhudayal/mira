import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '🔮 Mira: AI-Powered Data Analyst',
  description: 'Upload any CSV, get instant AI-powered insights with beautiful visualizations',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

