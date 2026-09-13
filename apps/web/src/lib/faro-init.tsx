'use client';

import { useEffect } from 'react';
import { initFaro } from '../instrumentation-client';

export function FaroInit() {
  useEffect(() => {
    initFaro();
  }, []);

  return null;
}
