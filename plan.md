# Sales Narrative Pre-Fill from Website URL + PDFs

## Summary
Add a "Smart Pre-Fill" step to the Sales Narrative questionnaire that lets the user provide a website URL and/or upload PDF files (e.g., sales decks). We crawl the website intelligently, extract text from PDFs, and use an LLM to take a best-effort shot at pre-filling the 9 Q&A fields before the user sees them.

## Architecture Overview

**Flow:**
1. User lands on `/sales-narrative/edit` (the questionnaire page)
2. Before showing the Q&A form, we show a new **"Smart Pre-Fill" panel** at the top: website URL input + PDF file upload
3. User provides URL and/or PDFs, clicks "Analyze & Pre-Fill"
4. Backend API endpoint processes everything:
   - **Website crawling**: fetch homepage → extract links → LLM picks the best pages → fetch those → strip HTML to text
   - **PDF parsing**: use existing `extractTextFromPDFWithOCR()`
   - **LLM pre-fill**: send all extracted context + the 9 questions to Chatbase → get back draft answers
5. Frontend receives draft answers and populates the textarea fields (user can edit before saving/generating)

## Detailed Plan

### Step 1: Backend — Website Crawler (`src/lib/narrative-prefill/crawl-website.ts`)

New module with these functions:

- **`crawlWebsiteForContext(url: string): Promise<string>`** — orchestrator
  1. Fetch the homepage HTML
  2. Extract all `<a href>` links (absolute + relative resolved to base URL), plus look for a `/sitemap.xml`
  3. Deduplicate links, filter to same-domain only
  4. Call OpenAI (gpt-4o-mini, cheap/fast) with the list of links + page title, asking it to pick the top ~8 most relevant URLs for understanding the company's product, problems solved, customers, pricing, proof points
  5. Fetch those selected pages in parallel (reuse `fetchPage` from `src/lib/search/fetcher.ts` for HTML stripping)
  6. Concatenate all page text, truncate to a reasonable limit (~50K chars)
  7. Return the combined text context

### Step 2: Backend — Pre-Fill API Route (`src/app/api/sales-narrative/prefill/route.ts`)

New `POST` endpoint:

**Request**: `multipart/form-data` with:
- `websiteUrl` (optional string)
- `files` (optional PDF files, multiple allowed)

**Processing**:
1. Auth check
2. In parallel:
   - If `websiteUrl` provided → call `crawlWebsiteForContext(url)`
   - For each PDF → call `extractTextFromPDFWithOCR(buffer, fileName)` → get `fullText`
3. Combine all context into one big string (website context + PDF contexts)
4. Load the 9 Sales Narrative questions from the DB
5. Send to Chatbase (via `sendToChatbase`) with a prompt like:
   > "Given the following company context, answer these 9 sales narrative questions as best you can. Return JSON with question IDs as keys."

   Use the existing Chatbase chunking pattern from `generate/route.ts` if the context exceeds the 7500-char limit.
6. Parse the JSON response, return `{ answers: Record<questionId, string> }`

### Step 3: Frontend — Smart Pre-Fill Panel (modify `src/app/sales-narrative/edit/page.tsx`)

Add a collapsible panel at the top of the questionnaire page:

- **Website URL input** (text field)
- **PDF upload area** (file input, `accept=".pdf"`, `multiple`)
  - Show file names as chips when selected
- **"Analyze & Pre-Fill" button**
  - Disabled until at least one input is provided
  - Shows loading state with progress messages
- When response comes back:
  - Populate any empty answer fields with the draft answers
  - Show a brief toast/banner: "Pre-filled X of Y questions from your materials — review and edit!"
  - Don't overwrite answers the user has already typed
- Panel collapses/hides after successful pre-fill (can be re-expanded)

### Step 4: Wire it all together

- The frontend sends `multipart/form-data` POST to `/api/sales-narrative/prefill`
- On success, merge returned answers into the `answers` state (only fill empty fields)
- Auto-save the pre-filled answers (same as existing auto-save)

## Key Design Decisions

1. **Chatbase over direct OpenAI** for the pre-fill LLM call — keeps it consistent with the existing generate flow and uses the same Chatbase bot context. However, given the 7500-char message limit, we may need the chunking strategy for large contexts. We'll chunk the context into conversation history messages, then send the final "now answer these questions" message.

2. **gpt-4o-mini for link selection** — this is a quick, cheap call just to pick which URLs to crawl. No need for a heavy model.

3. **Reuse existing PDF infrastructure** — `extractTextFromPDFWithOCR` already handles text extraction with OCR fallback perfectly.

4. **Reuse existing fetcher** — `fetchPage` from `src/lib/search/fetcher.ts` already does HTML-to-text stripping.

5. **Pre-fill is optional** — users can skip it entirely and fill in manually as before. The existing flow is untouched.

## Files to Create
- `src/lib/narrative-prefill/crawl-website.ts` — website crawling + link selection
- `src/app/api/sales-narrative/prefill/route.ts` — API endpoint

## Files to Modify
- `src/app/sales-narrative/edit/page.tsx` — add Smart Pre-Fill panel UI
