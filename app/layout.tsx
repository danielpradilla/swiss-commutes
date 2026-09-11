import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';

const image = { url: '/swiss-commutes/social/zurich.jpg', width: 1388, height: 728,
  alt: 'Commuting in Zürich at 07:45: map and commuter statistics.' };

export const metadata: Metadata = {
  metadataBase: new URL('https://www.danielpradilla.info'),
  title: 'Swiss Commutes | A day of commuting',
  description: 'Animated maps of weekday commuting in Switzerland’s largest cities.',
  alternates: { canonical: '/swiss-commutes/' },
  openGraph: {
    title: 'Swiss Commutes',
    description: '24-hour maps of commuting in Switzerland’s largest cities.',
    type: 'website',
    images: [image],
  },
  twitter: {
    card: 'summary_large_image',
    images: [image],
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
