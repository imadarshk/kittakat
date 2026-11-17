import type { Metadata, Viewport } from 'next';
import './globals.css';
import { themeBootScript } from '../lib/theme';
export const metadata: Metadata = {
 title: 'कित्ताकाट — Good company. Clear accounts.',
 description: 'A little clarity for everything you share. Split NPR expenses, review the details, and settle up with your people.',
 icons: { icon: '/favicon.svg', shortcut: '/favicon.svg', apple: '/apple-touch-icon.png' },
 manifest: '/manifest.webmanifest',
 appleWebApp: { capable: true, title: 'कित्ताकाट', statusBarStyle: 'default' },
};
export const viewport: Viewport = {
 width: 'device-width', initialScale: 1, viewportFit: 'cover',
 themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f5f2eb' }, { media: '(prefers-color-scheme: dark)', color: '#27241e' }],
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootScript }}/></head><body>{children}</body></html>;
}
