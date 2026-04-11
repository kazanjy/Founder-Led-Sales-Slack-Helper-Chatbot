import { MeetingRecorderProvider } from "./interface";
import { granolaProvider } from "./granola";
import { firefliesProvider } from "./fireflies";
import { fathomProvider } from "./fathom";

const providers: Record<string, MeetingRecorderProvider> = {
  granola: granolaProvider,
  fireflies: firefliesProvider,
  fathom: fathomProvider,
};

export function getProvider(slug: string): MeetingRecorderProvider | null {
  return providers[slug] || null;
}

export function getAllProviders(): MeetingRecorderProvider[] {
  return Object.values(providers);
}

export { providers };
