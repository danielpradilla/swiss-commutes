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
  title: 'Swiss Border Commutes | One weekday, in motion',
  description: 'Interactive portraits of commuter movement across Switzerland’s border labour markets.',
  alternates: { canonical: '/swiss-border-commutes/' },
  openGraph: {
    title: 'Swiss Border Commutes',
    description: '24-hour maps of commuting in Switzerland’s border cities.',
    type: 'website',
    images: [{ url: '/swiss-border-commutes/og.png', width: 1732, height: 910, alt: 'Swiss Border Commutes' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Swiss Border Commutes',
    description: '24-hour maps of commuting in Switzerland’s border cities.',
    images: ['/swiss-border-commutes/og.png'],
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
