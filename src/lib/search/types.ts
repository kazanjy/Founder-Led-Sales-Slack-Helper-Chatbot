// ============================================
// Search Infrastructure Types
// ============================================

/** Raw freeform input from user (Slack or web) */
export interface SearchInput {
  /** Freeform text — could be "researching Acme Corp, meeting with Jane Doe CTO" */
  freeformText?: string;
  /** Explicit company name if provided separately */
  companyName?: string;
  /** Explicit contact name if provided separately */
  contactName?: string;
  /** Explicit contact title if provided separately */
  contactTitle?: string;
  /** Direct URLs the user wants fetched */
  urls?: string[];
}

/** Structured fields extracted from freeform input by the input parser */
export interface ParsedSearchInput {
  companyName: string;
  companyDomain?: string;
  contactName?: string;
  contactTitle?: string;
  contactLinkedIn?: string;
  industry?: string;
  urls: string[];
  /** Additional context extracted from the freeform text */
  additionalContext?: string;
}

/** A single search query to execute against Brave */
export interface SearchQuery {
  query: string;
  /** What this query is trying to find */
  purpose: string;
  /** Priority: higher priority queries run first if rate-limited */
  priority: number;
}

/** A URL to fetch directly (not via search) */
export interface DirectFetch {
  url: string;
  /** What we expect to find at this URL */
  purpose: string;
}

/** The plan for what to search and fetch */
export interface SearchPlan {
  /** Brave search queries to execute */
  queries: SearchQuery[];
  /** URLs to fetch directly */
  directFetches: DirectFetch[];
  /** The parsed input that generated this plan */
  parsedInput: ParsedSearchInput;
}

/** A single result from Brave Search */
export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  /** Age of the result if available */
  age?: string;
}

/** Response from a Brave Search API call */
export interface BraveSearchResponse {
  query: string;
  purpose: string;
  results: BraveSearchResult[];
  error?: string;
}

/** Content fetched from a direct URL */
export interface FetchedPage {
  url: string;
  purpose: string;
  title?: string;
  /** Extracted text content (HTML stripped) */
  textContent: string;
  /** Whether the fetch succeeded */
  success: boolean;
  error?: string;
}

/** Aggregated search + fetch results, ready for synthesis */
export interface SearchResults {
  /** Original parsed input */
  parsedInput: ParsedSearchInput;
  /** Results from Brave searches */
  searchResults: BraveSearchResponse[];
  /** Results from direct URL fetches */
  fetchedPages: FetchedPage[];
  /** Total number of results across all queries */
  totalResults: number;
}

/** The final research brief output */
export interface ResearchBrief {
  /** Company name */
  companyName: string;
  /** Contact name if researched */
  contactName?: string;
  /** The full markdown research brief */
  content: string;
  /** Sources used */
  sources: { title: string; url: string }[];
  /** When the research was generated */
  generatedAt: Date;
}

/** Progress callback for streaming updates */
export type SearchProgressCallback = (update: SearchProgressUpdate) => void;

export interface SearchProgressUpdate {
  stage: "parsing" | "planning" | "searching" | "fetching" | "synthesizing" | "complete" | "error";
  message: string;
  /** 0-100 */
  progress: number;
  /** Partial data available at this stage */
  partialData?: Partial<SearchResults>;
}
