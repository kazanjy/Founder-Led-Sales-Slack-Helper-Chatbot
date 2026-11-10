import { MeetingRecorderProvider } from "./interface";
import { granolaProvider } from "./granola";
import { firefliesProvider } from "./fireflies";
import { fathomProvider } from "./fathom";
import { circlebackProvider } from "./circleback";

const providers: Record<string, MeetingRecorderProvider> = {
  granola: granolaProvider,
  fireflies: firefliesProvider,
  fathom: fathomProvider,
  circleback: circlebackProvider,
};

export function getProvider(slug: string): MeetingRecorderProvider | null {
  return providers[slug] || null;
}

export function getAllProviders(): MeetingRecorderProvider[] {
  return Object.values(providers);
}

export { providers };
