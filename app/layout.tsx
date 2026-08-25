import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://danielpradilla.info'),
  title: 'Genève / 24h — A commuter portrait',
  description: 'An interactive portrait of commuter movement into and out of Geneva over one weekday.',
  alternates: { canonical: '/geneva-commutes/' },
  openGraph: {
    title: 'Genève / 24h — How Geneva breathes',
    description: 'Follow the daily commuter pulse across Geneva, France and Vaud.',
    type: 'website',
    images: [{ url: '/geneva-commutes/og.png', width: 1732, height: 910, alt: 'Genève / 24h — How Geneva breathes' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Genève / 24h — How Geneva breathes',
    description: 'Follow the daily commuter pulse across Geneva, France and Vaud.',
    images: ['/geneva-commutes/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-CH">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
