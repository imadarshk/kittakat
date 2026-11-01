import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title: 'कित्ताकाट — Good company. Clear accounts.',
 description: 'A little clarity for everything you share. Split NPR expenses, review the details, and settle up with your people.',
 icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
