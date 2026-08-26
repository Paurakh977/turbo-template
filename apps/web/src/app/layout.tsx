import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import localFont from 'next/font/local';
import '../styles/globals.css';
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '../lib/theme';
import { ToastProvider } from '../lib/toast-context';

const geistSans = localFont({
  src: '../fonts/GeistVF.woff',
  variable: '--font-geist-sans',
});
const geistMono = localFont({
  src: '../fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'Ozon',
    template: '%s - Ozon',
  },
  description: 'Ozon - secure full-stack application',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get(THEME_STORAGE_KEY)?.value;
  const themeClass = theme === 'dark' ? 'dark' : '';

  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={themeClass} suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
