"use client";

import { useEffect, useState } from 'react';
import type { Link as LinkType } from '@repo/api';
import { Button } from '@repo/ui/button';
import Image, { type ImageProps } from 'next/image';
import Link from 'next/link';

import styles from '../styles/page.module.css';



type Props = Omit<ImageProps, 'src'> & {
  srcLight: string;
  srcDark: string;
};

const ThemeImage = (props: Props) => {
  const { srcLight, srcDark, ...rest } = props;

  return (
    <>
      <Image {...rest} src={srcLight} className="imgLight" />
      <Image {...rest} src={srcDark} className="imgDark" />
    </>
  );
};

export default function Home() {
  const [links, setLinks] = useState<LinkType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLinks() {
      try {
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const res = await fetch(`${apiBaseUrl}/links`);
        if (res.ok) {
          setLinks(await res.json());
        }
      } catch (error) {
        console.error('Error fetching links:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchLinks();
  }, []);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <ThemeImage
          className={styles.logo}
          srcLight="/turborepo-dark.svg"
          srcDark="/turborepo-light.svg"
          alt="Turborepo logo"
          width={180}
          height={38}
          priority
        />
        <ol>
          <li>
            Get started by editing <code>apps/web/src/app/page.tsx</code>
          </li>
          <li>Save and see your changes instantly.</li>
        </ol>

        <div className={styles.ctas}>
          <Link href="/auth" className={styles.primary}>
            Sign In / Sign Up
          </Link>
          <Link href="/dashboard" className={styles.secondary}>
            Dashboard
          </Link>
        </div>

        <Button appName="web" className={styles.secondary}>
          Open alert
        </Button>

        {loading ? (
          <div style={{ color: '#666' }}>Loading links...</div>
        ) : links.length > 0 ? (
          <div className={styles.ctas}>
            {links.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.description}
                className={styles.secondary}
              >
                {link.title}
              </a>
            ))}
          </div>
        ) : (
          <div style={{ color: '#666' }}>
            No links available. Make sure the proxy, web, and API containers
            are running.
          </div>
        )}
      </main>
    </div>
  );
}
