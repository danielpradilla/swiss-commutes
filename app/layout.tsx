import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.danielpradilla.info'),
  icons: { icon: '/swiss-commutes/favicon.svg' },
  title: 'Swiss Commutes | A day of commuting',
  description: 'Animated maps of weekday commuting in Switzerland’s largest cities.',
  alternates: { canonical: '/swiss-commutes/' },
  openGraph: {
    title: 'Swiss Commutes',
    description: '24-hour maps of commuting in Switzerland’s largest cities.',
    type: 'website',
    images: ['/swiss-commutes/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/swiss-commutes/og.png'],
    title: 'Swiss Commutes',
    description: '24-hour maps of commuting in Switzerland’s largest cities.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-CH">
      <body>{children}</body>
    </html>
  );
}
