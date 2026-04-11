import { MeetingRecorderProvider } from "./interface";
import { granolaProvider } from "./granola";

const providers: Record<string, MeetingRecorderProvider> = {
  granola: granolaProvider,
};

export function getProvider(slug: string): MeetingRecorderProvider | null {
  return providers[slug] || null;
}

export function getAllProviders(): MeetingRecorderProvider[] {
  return Object.values(providers);
}

export { providers };
