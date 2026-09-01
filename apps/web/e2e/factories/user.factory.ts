import { E2E } from '../config/playwright.env';

export interface GeneratedUser {
  name: string;
  email: string;
  password: string;
}

const ADJ = ['swift', 'calm', 'brave', 'quiet', 'bold', 'lucky', 'wise', 'keen'];
const NOUN = ['otter', 'falcon', 'maple', 'comet', 'river', 'onion', 'pixel', 'ember'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Deterministic, policy-compliant password: upper+lower+digit+symbol, >=8. */
export function makePassword(seed = 'x'): string {
  return `E2e${seed}Pass-1`;
}

/** Generate a throwaway user that satisfies the password policy. */
export function makeUser(role = 'user'): GeneratedUser {
  const handle = `${pick(ADJ)}${pick(NOUN)}${Math.floor(Math.random() * 9000) + 1000}`;
  return {
    name: handle,
    email: `${handle}@${E2E.testUserDomain}`,
    password: makePassword(handle.slice(0, 3)),
  };
}
