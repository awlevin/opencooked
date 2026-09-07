import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://opencooked.vercel.app'),
  title: 'Opencooked',
  description:
    'Turn any screen into a couch co-op cooking party. Everyone plays from their phone.',
  openGraph: {
    title: 'Opencooked — phones out, aprons on',
    description: 'Turn any screen into a couch co-op cooking party. Up to 8 chefs, zero downloads.',
    images: ['/opengraph-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Opencooked — phones out, aprons on',
    description: 'Turn any screen into a couch co-op cooking party. Up to 8 chefs, zero downloads.',
    images: ['/twitter-image.png'],
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
  other: { 'mobile-web-app-capable': 'yes', 'format-detection': 'telephone=no' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1c110a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
