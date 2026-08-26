import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import 'leaflet/dist/leaflet.css';
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
  title: 'Swiss Commutes | One weekday, in motion',
  description: 'Interactive portraits of commuter movement across Switzerland’s largest cities.',
  alternates: { canonical: '/swiss-commutes/' },
  openGraph: {
    title: 'Swiss Commutes',
    description: '24-hour maps of commuting in Switzerland’s largest cities.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
