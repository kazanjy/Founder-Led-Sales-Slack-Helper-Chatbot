/**
 * Prompts for the Sales Metrics Analyzer
 */

export function getCSVParsePrompt(csvText: string, questionsList: string): string {
  return `You are an expert sales analytics engine. The user has uploaded a CSV export of their CRM opportunity/deal data. Your job is to analyze this data and calculate specific sales metrics.

## CSV DATA:

${csvText}

## METRICS TO CALCULATE:

For each of the following questions, calculate the answer from the CSV data. If a metric cannot be calculated from the available columns, set the value to null and explain why in the explanation field.

${questionsList}

## INSTRUCTIONS:

1. First, identify the relevant columns in the CSV (e.g., close date, created date, amount, stage, win/loss status, lead source, owner, etc.)
2. Calculate each metric as accurately as possible from the data
3. For percentage metrics, express as a percentage (e.g., "25%")
4. For dollar amounts, express as a number (e.g., "50000")
5. For counts, express as a whole number (e.g., "12")
6. For time periods, express in days (e.g., "45 days")
7. Also extract any additional insights you find interesting (trends, patterns, anomalies)

## OUTPUT FORMAT (respond with ONLY valid JSON):

{
  "columnMapping": {
    "description": "Brief description of how you mapped CSV columns to metrics"
  },
  "prefillAnswers": {
    "1": { "value": "calculated value or null", "explanation": "how this was calculated" },
    "2": { "value": "...", "explanation": "..." }
  },
  "additionalInsights": {
    "totalOpportunities": "number",
    "dateRange": "earliest to latest date in data",
    "winRateBySource": {},
    "winRateByOwner": {},
    "avgDealSizeBySource": {},
    "dealCountByStage": {},
    "monthlyTrends": {},
    "notablePatterns": ["pattern 1", "pattern 2"]
  }
}`;
}

export function getAnalysisPrompt(questionsAndAnswers: string, csvText?: string, csvInsights?: string): string {
  return `You are Pete Kazanjy, a world-class B2B sales expert and author of "Founding Sales." You are analyzing a founder's sales metrics to provide actionable coaching.

## SUBMITTED SALES METRICS:

${questionsAndAnswers}

${csvText ? `## RAW OPPORTUNITY DATA (CSV):

${csvText}

` : ""}${csvInsights ? `## PRE-COMPUTED INSIGHTS FROM CSV:

${csvInsights}

` : ""}## INSTRUCTIONS:

Analyze these sales metrics comprehensively. Consider:
- How each metric compares to typical B2B SaaS benchmarks
- The relationships between metrics (e.g., low win rate + high meeting count = qualification problem)
- What the metrics reveal about the sales process maturity
- If CSV data is provided, analyze trends over time, performance by lead source, by rep, etc.

## OUTPUT FORMAT (respond with ONLY valid JSON):

{
  "top3Strengths": [
    { "title": "Short title", "detail": "2-3 sentence explanation of why this is a strength and what it indicates" }
  ],
  "top3Improvements": [
    { "title": "Short title", "detail": "2-3 sentence explanation of why this needs improvement and the impact" }
  ],
  "workOnNext": {
    "title": "The single most impactful thing to work on",
    "detail": "Why this is the priority",
    "actionSteps": ["Specific action 1", "Specific action 2", "Specific action 3"]
  },
  "metricsTable": {
    "1": { "value": "submitted value", "benchmark": "typical range for B2B SaaS", "rating": "good|ok|needs_work" },
    "2": { "value": "...", "benchmark": "...", "rating": "..." }
  },
  "generalAnalysis": "A comprehensive markdown narrative (500-1000 words) covering the overall sales health, process maturity, and strategic recommendations. Include specific numbers from their data.",
  "csvDeepDive": ${csvText ? `{
    "winRateBySource": "Markdown table or summary of win rates by lead source",
    "trends": "Markdown analysis of trends over time (win rate, ASP, cycle length, pipeline creation)",
    "repPerformance": "Markdown analysis of individual rep performance (if multiple owners in data)",
    "pipelineHealth": "Analysis of current pipeline stage distribution and velocity",
    "otherInsights": "Any other notable patterns, anomalies, or opportunities found in the data"
  }` : "null"}
}`;
}

export function getMetricsAssessmentTitle(analysisReport: string): string {
  return `Generate a one-sentence summary title (under 80 chars) for this sales metrics analysis:\n\n${analysisReport.substring(0, 2000)}`;
}
