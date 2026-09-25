'use client';

import { SegmentErrorCard } from './_components/segment-error';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentErrorCard error={error} reset={reset} scope="Root" />;
}
