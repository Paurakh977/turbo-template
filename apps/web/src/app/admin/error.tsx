'use client';

import { SegmentErrorCard } from '../_components/segment-error';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentErrorCard error={error} reset={reset} scope="Admin" />;
}
