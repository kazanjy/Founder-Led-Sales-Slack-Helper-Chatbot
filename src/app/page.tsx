import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StickyCtaBar from "@/components/StickyCtaBar";
import { AuthButtons, AuthButtonsCTA } from "@/components/AuthButtons";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";

export const metadata: Metadata = {
  title: "Mikey - Your AI-Powered Founder-Led Sales Platform",
  description:
    "Build your complete sales playbook automatically — narrative, ICP, discovery questions, sales decks, outreach sequences, and more. Each step auto-generates from the last. Based on Pete Kazanjy's Founding Sales methodology.",
  openGraph: {
    title: "Mikey - Your AI-Powered Founder-Led Sales Platform",
    description:
      "Build your complete sales playbook automatically — narrative, ICP, discovery questions, sales decks, outreach sequences, and more. Based on Pete Kazanjy's Founding Sales methodology.",
    type: "website",
    url: appUrl,
    siteName: "Mikey",
    images: [
      {
        url: `${appUrl}/mikey-avatar.png`,
        width: 512,
        height: 512,
        type: "image/png",
        alt: "Mikey - AI-Powered Founder-Led Sales Platform",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Mikey - Your AI-Powered Founder-Led Sales Platform",
    description:
      "Build your complete sales playbook automatically — narrative, ICP, discovery questions, sales decks, outreach sequences, and more. Based on Pete Kazanjy's Founding Sales methodology.",
    images: [`${appUrl}/mikey-avatar.png`],
  },
};

interface HomeProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Home({ searchParams }: HomeProps) {
  // Check if user is already logged in
  const user = await getCurrentUser();
  if (user) {
    redirect("/chat");
  }

  const params = await searchParams;
  const installed = params.installed === "true";
  const workspace = params.workspace as string | undefined;
  const error = params.error as string | undefined;

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Top Navigation */}
      <nav className="w-full px-6 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-10 h-10 rounded-lg"
            />
            <span className="font-bold text-xl text-gray-900">Mikey</span>
          </div>
          <a
            href="/signin"
            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium rounded-lg hover:bg-gray-100 transition-colors"
          >
            Sign In
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-12 pb-12 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-48 h-48 mx-auto mb-6 rounded-2xl shadow-lg"
          />

          <h1 className="text-5xl font-bold mb-4 text-gray-900">
            Meet Mikey
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Your AI-Powered Founder-Led Sales Platform
          </p>
          <p className="text-lg text-gray-500 mb-8 max-w-2xl mx-auto">
            Build your sales playbook, define your ICP, generate outreach sequences and social content,
            create presentation decks, research prospects, review calls, and get ongoing coaching &mdash; all based on Pete Kazanjy&apos;s <em>Founding Sales</em> methodology.
          </p>

          {installed && (
            <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-lg max-w-md mx-auto">
              <p className="text-green-800">
                Successfully installed to{" "}
                <strong>{workspace || "your workspace"}</strong>! Check your Slack
                for a welcome message from Mikey.
              </p>
            </div>
          )}

          {error && (
            <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg max-w-md mx-auto">
              <p className="text-red-800">
                {error === "workspace_not_found"
                  ? "Your workspace hasn't installed Mikey yet. Please install first."
                  : error === "not_logged_in"
                  ? "Please sign in to continue."
                  : `Error: ${error}. Please try again.`}
              </p>
            </div>
          )}

          {/* Two-Path CTAs */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-6 mb-6">
            <a
              href="/signin?next=/chat?startAssessment=true"
              className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 text-lg font-semibold text-white rounded-xl overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-xl"
              style={{
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              }}
            >
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
                  animation: "shimmer 2s infinite",
                }}
              />
              <svg className="w-6 h-6 relative z-10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
              </svg>
              <span className="relative z-10">Take GTM Assessment</span>
            </a>

            <span className="text-gray-400 hidden md:block">or</span>

            <div className="flex flex-col items-center gap-2">
              <AuthButtons variant="signup" />
            </div>
          </div>

          <p className="text-sm text-gray-500">
            Already signed in?{" "}
            <a href="/chat" className="text-blue-600 hover:underline">
              Go to Chat
            </a>
          </p>
        </div>
      </section>

      {/* Sales Playbook Section - NEW */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            Build Your Complete Sales Playbook
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Mikey walks you through a guided workflow to create every artifact you need for founder-led sales &mdash; personalized to your product, market, and stage. Each step is <strong>auto-generated</strong> from the last, so your entire playbook builds itself. Then edit, refine, and evolve any piece as you learn.
          </p>

          {/* Playbook Workflow Steps */}
          <div className="relative">
            {/* Connection line (desktop only) */}
            <div className="hidden lg:block absolute top-10 left-[8%] right-[8%] h-0.5 bg-gradient-to-r from-purple-200 via-blue-200 to-green-200" />

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-6">
              {/* Step 1 */}
              <div className="text-center relative">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-purple-100 to-purple-50 rounded-2xl flex items-center justify-center border border-purple-200 relative z-10">
                  <svg className="w-9 h-9 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">GTM Assessment</h3>
                <p className="text-xs text-gray-500">Evaluate your go-to-market maturity</p>
              </div>

              {/* Step 2 */}
              <div className="text-center relative">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-blue-100 to-blue-50 rounded-2xl flex items-center justify-center border border-blue-200 relative z-10">
                  <svg className="w-9 h-9 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">Sales Narrative</h3>
                <p className="text-xs text-gray-500">Generate your product story and positioning</p>
              </div>

              {/* Step 3 - ICP (NEW) */}
              <div className="text-center relative">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-cyan-100 to-cyan-50 rounded-2xl flex items-center justify-center border border-cyan-200 relative z-10">
                  <svg className="w-9 h-9 text-cyan-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">Ideal Customer Profile</h3>
                <p className="text-xs text-gray-500">Define your ICP with search criteria</p>
              </div>

              {/* Step 4 - Sales Deck */}
              <div className="text-center relative">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-orange-100 to-rose-50 rounded-2xl flex items-center justify-center border border-orange-200 relative z-10">
                  <svg className="w-9 h-9 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">Sales Deck</h3>
                <p className="text-xs text-gray-500">Build a tailored pitch presentation</p>
              </div>

              {/* Step 5 */}
              <div className="text-center relative">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center border border-green-200 relative z-10">
                  <svg className="w-9 h-9 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">Discovery Questions</h3>
                <p className="text-xs text-gray-500">Craft questions that uncover real pain</p>
              </div>

              {/* Step 6 */}
              <div className="text-center relative">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-amber-100 to-amber-50 rounded-2xl flex items-center justify-center border border-amber-200 relative z-10">
                  <svg className="w-9 h-9 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">First Call Checklist</h3>
                <p className="text-xs text-gray-500">Know exactly what to cover on every call</p>
              </div>

              {/* Step 7 */}
              <div className="text-center relative">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-teal-100 to-teal-50 rounded-2xl flex items-center justify-center border border-teal-200 relative z-10">
                  <svg className="w-9 h-9 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">Pre-Call Checklist</h3>
                <p className="text-xs text-gray-500">Personalized prep for every meeting</p>
              </div>
            </div>
          </div>

          <div className="text-center mt-10">
            <a
              href="/signin?next=/chat?startAssessment=true"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all font-semibold shadow-md hover:shadow-lg"
            >
              Start Building Your Playbook
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* Two Value Props Side by Side */}
      <section className="py-16 px-6 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Assessment Value Prop */}
            <div className="bg-gradient-to-br from-purple-50 to-white rounded-2xl p-8 border border-purple-100">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">GTM Maturity Assessment</h3>
              <p className="text-gray-600 mb-4">
                Answer questions about your go-to-market strategy and get a personalized analysis with prioritized recommendations.
              </p>
              <ul className="text-sm text-gray-600 space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Evaluate ICP, prospecting, sales process & more
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Get prioritized action items
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Chat about your results anytime
                </li>
              </ul>
              <a
                href="/signin?next=/chat?startAssessment=true"
                className="inline-flex items-center gap-2 text-purple-700 font-semibold hover:text-purple-800"
              >
                Start Assessment
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>

            {/* Sales Playbook & Coaching Value Prop */}
            <div className="bg-gradient-to-br from-blue-50 to-white rounded-2xl p-8 border border-blue-100">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Sales Playbook & Coaching</h3>
              <p className="text-gray-600 mb-4">
                Build your complete sales playbook with structured tools, then chat with Mikey anytime for ongoing coaching &mdash; on the web or in Slack.
              </p>
              <ul className="text-sm text-gray-600 space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Sales narrative, ICP, discovery questions, call checklists
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Pre-call research, call review, cold call scripts, objection library
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Sales decks with PDF/PPTX export, email &amp; LinkedIn sequences
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Social posts, ads, sales metrics, coaching &mdash; web or Slack
                </li>
              </ul>
              <a
                href="/signin"
                className="inline-flex items-center gap-2 text-blue-700 font-semibold hover:text-blue-800"
              >
                Start Chatting
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Real Tools Section - organized by category */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            Real Tools, Not Just a Chatbot
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Mikey doesn&apos;t just answer questions &mdash; it generates polished, shareable sales artifacts you can actually use.
          </p>

          {/* Playbook & Strategy */}
          <div className="mb-10">
            <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </span>
              Playbook &amp; Strategy
            </h3>
            <div className="grid md:grid-cols-3 gap-6">
              {/* Sales Narrative */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Sales Narrative</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Generate your compelling product story &mdash; the narrative arc that turns features into a story prospects actually care about.
                </p>
                <span className="text-xs text-purple-600 font-medium">Your product story, refined</span>
              </div>

              {/* Ideal Customer Profile */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Ideal Customer Profile</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Define your ICP and auto-generate search criteria for LinkedIn, Apollo, ZoomInfo, and other prospecting platforms.
                </p>
                <span className="text-xs text-cyan-600 font-medium">ICP + search criteria generation</span>
              </div>

              {/* Discovery Questions */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Discovery Questions</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Craft targeted discovery questions that uncover real pain, urgency, and buying signals specific to your market.
                </p>
                <span className="text-xs text-green-600 font-medium">Tailored to your ICP</span>
              </div>

              {/* Objection Library */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-rose-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Objection Library</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Build a curated library of objections and AI-generated responses. Look up any objection and instantly find the best way to handle it.
                </p>
                <span className="text-xs text-rose-600 font-medium">AI-powered objection handling</span>
              </div>

              {/* Sales Metrics Analysis */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Sales Metrics Analysis</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Upload CRM data or enter your numbers &mdash; get benchmarked performance analysis with pipeline health, conversion rates, and priorities.
                </p>
                <span className="text-xs text-emerald-600 font-medium">CSV upload or manual entry</span>
              </div>

              {/* Coaching History */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-violet-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Coaching History</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Log coaching sessions with notes and transcripts, then chat with Mikey about your progress and patterns over time.
                </p>
                <span className="text-xs text-violet-600 font-medium">Track your growth</span>
              </div>
            </div>
          </div>

          {/* Content & Outreach */}
          <div className="mb-10">
            <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </span>
              Content &amp; Outreach
            </h3>
            <div className="grid md:grid-cols-3 gap-6">
              {/* Email Sequences */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Email Sequences</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Generate multi-step outreach sequences tailored to your target personas, complete with subject lines and follow-up cadence.
                </p>
                <span className="text-xs text-blue-600 font-medium">Personalized by persona</span>
              </div>

              {/* LinkedIn Sequences */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">LinkedIn Sequences</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Create connection request + follow-up message sequences designed for LinkedIn&apos;s conversational format.
                </p>
                <span className="text-xs text-indigo-600 font-medium">Optimized for LinkedIn</span>
              </div>

              {/* Social Content */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-sky-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Social Content</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Generate LinkedIn and Twitter posts with tone and topic control &mdash; thought leadership, promotional, educational, and more.
                </p>
                <span className="text-xs text-sky-600 font-medium">LinkedIn + Twitter posts</span>
              </div>

              {/* Ad Creator */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-fuchsia-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-fuchsia-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Ad Creator</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Generate ad copy for LinkedIn Ads, Facebook/Instagram Ads, and Google SEM &mdash; matched to your personas and tone.
                </p>
                <span className="text-xs text-fuchsia-600 font-medium">Multi-platform ad copy</span>
              </div>

              {/* Sales Decks */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Sales Decks</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Generate full presentation decks with Gamma integration &mdash; export to PDF and PPTX, or upload an existing deck for AI enhancement.
                </p>
                <span className="text-xs text-amber-600 font-medium">PDF + PPTX export via Gamma</span>
              </div>

              {/* Cold Call Scripts */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Cold Call Scripts</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Generate call scripts with openers, objection handling, and closing techniques &mdash; tailored to specific buyer personas.
                </p>
                <span className="text-xs text-red-600 font-medium">Persona-specific scripts</span>
              </div>
            </div>
          </div>

          {/* Call Execution & Coaching */}
          <div>
            <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </span>
              Call Execution &amp; Coaching
            </h3>
            <div className="grid md:grid-cols-3 gap-6">
              {/* Pre-Call Research */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-teal-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Pre-Call Research</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Enter a company and contact &mdash; get a comprehensive research brief with company intel, persona analysis, and conversation angles.
                </p>
                <span className="text-xs text-teal-600 font-medium">Automated web research + AI synthesis</span>
              </div>

              {/* Call Review */}
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">Call Review Scorecard</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Upload a call transcript or recording and get a detailed scorecard analyzing your discovery, demo, and closing performance.
                </p>
                <span className="text-xs text-green-600 font-medium">AI-powered call analysis</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Call Review Callout */}
      <section className="py-16 px-6 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-green-50 to-white rounded-2xl p-8 md:p-12 border border-green-100 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-shrink-0">
              <div className="w-28 h-28 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-14 h-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Get Your Calls Reviewed by AI
              </h3>
              <p className="text-gray-600 mb-4">
                Upload a call transcript or recording and get a detailed scorecard &mdash; covering discovery depth, demo effectiveness, next steps, and areas for improvement. Like having a sales manager review every call.
              </p>
              <a
                href="/signin?next=/call-review"
                className="inline-flex items-center gap-2 text-green-700 font-semibold hover:text-green-800"
              >
                Try Call Review
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Pre-Call Research Callout */}
      <section className="py-4 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-teal-50 to-white rounded-2xl p-8 md:p-12 border border-teal-100 flex flex-col md:flex-row-reverse items-center gap-8">
            <div className="flex-shrink-0">
              <div className="w-28 h-28 bg-gradient-to-br from-teal-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-14 h-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Research Any Prospect in Minutes
              </h3>
              <p className="text-gray-600 mb-4">
                Enter a company name and contact &mdash; Mikey crawls the web, analyzes their business, and generates a comprehensive research brief with talking points, potential pain points, and conversation angles. Share the results with your team via a link.
              </p>
              <a
                href="/signin?next=/pre-call-planning/research"
                className="inline-flex items-center gap-2 text-teal-700 font-semibold hover:text-teal-800"
              >
                Try Pre-Call Research
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Sales Metrics Callout */}
      <section className="py-4 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-emerald-50 to-white rounded-2xl p-8 md:p-12 border border-emerald-100 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-shrink-0">
              <div className="w-28 h-28 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-14 h-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Benchmark Your Sales Performance
              </h3>
              <p className="text-gray-600 mb-4">
                Upload your CRM data as a CSV or enter your pipeline numbers manually &mdash; Mikey analyzes conversion rates, deal velocity, pipeline health, and rep performance, then benchmarks you and surfaces the top priorities to fix.
              </p>
              <a
                href="/signin?next=/sales-metrics"
                className="inline-flex items-center gap-2 text-emerald-700 font-semibold hover:text-emerald-800"
              >
                Try Sales Metrics Analysis
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Content Creation Callout */}
      <section className="py-4 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-sky-50 to-white rounded-2xl p-8 md:p-12 border border-sky-100 flex flex-col md:flex-row-reverse items-center gap-8">
            <div className="flex-shrink-0">
              <div className="w-28 h-28 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-14 h-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Generate Social Posts, Ads &amp; Presentation Decks
              </h3>
              <p className="text-gray-600 mb-4">
                Create LinkedIn and Twitter posts, ad copy for LinkedIn/Facebook/Google, and full presentation decks with PDF and PPTX export &mdash; all personalized to your narrative and target personas. Choose your tone, topic, and platform, and get polished content in seconds.
              </p>
              <a
                href="/signin?next=/social-content"
                className="inline-flex items-center gap-2 text-sky-700 font-semibold hover:text-sky-800"
              >
                Try Social Content
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Works Everywhere */}
      <section className="py-16 px-6 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4 text-gray-900">
            Works Where You Work
          </h2>
          <p className="text-gray-600 mb-10 max-w-xl mx-auto">
            Use Mikey on the web, in Slack, or both. Share any document with a public link &mdash; no login required for viewers.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-3 mx-auto">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Web App</h3>
              <p className="text-sm text-gray-500">Full platform with all tools, voice input, file uploads, and chat</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="w-12 h-12 bg-[#4A154B]/10 rounded-lg flex items-center justify-center mb-3 mx-auto">
                <svg className="w-6 h-6 text-[#4A154B]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Slack</h3>
              <p className="text-sm text-gray-500">DM Mikey right in Slack for quick coaching and research</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-3 mx-auto">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Shareable Links</h3>
              <p className="text-sm text-gray-500">Share any document via public link &mdash; research briefs, scorecards, narratives</p>
            </div>
          </div>
        </div>
      </section>

      {/* Training Content Section */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            Powered by Proven Methodology
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Mikey is trained on battle-tested founder-led sales frameworks and real-world B2B expertise.
          </p>

          <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl shadow-lg border border-gray-100 p-8">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-shrink-0">
                <div className="w-32 h-40 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg shadow-md flex items-center justify-center">
                  <span className="text-white text-center font-bold px-3 text-sm">Founding Sales</span>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2 text-gray-900">
                  Trained on Pete Kazanjy&apos;s Complete Body of Work
                </h3>
                <p className="text-gray-600 mb-4">
                  Mikey is trained on <em>Founding Sales</em>, all of Pete&apos;s essays, his complete class curriculum,
                  plus hundreds of pages of templates, real-world sales assets, interviews, and more.
                  It&apos;s like having Pete&apos;s entire founder-led sales brain at your fingertips.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Founding Sales Book</span>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Essays & Articles</span>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Class Content</span>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Templates</span>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Sales Assets</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 grid md:grid-cols-3 gap-4">
            <div className="text-center p-4">
              <div className="text-3xl font-bold text-blue-600 mb-1">1000s</div>
              <div className="text-sm text-gray-600">Pages of sales methodology</div>
            </div>
            <div className="text-center p-4">
              <div className="text-3xl font-bold text-blue-600 mb-1">15+</div>
              <div className="text-sm text-gray-600">Years of B2B expertise</div>
            </div>
            <div className="text-center p-4">
              <div className="text-3xl font-bold text-blue-600 mb-1">1000s</div>
              <div className="text-sm text-gray-600">Of startups influenced</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-6 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="max-w-3xl mx-auto text-center">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-20 h-20 mx-auto mb-6 rounded-xl shadow-lg border-2 border-white/20"
          />
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to level up your sales game?
          </h2>
          <p className="text-blue-100 mb-8 text-lg">
            Build your playbook, define your ICP, generate content and decks, research prospects, review calls, and get ongoing coaching &mdash; all in one place.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/signin?next=/chat?startAssessment=true"
              className="inline-flex items-center justify-center gap-2 bg-white text-purple-700 font-semibold py-3 px-6 rounded-lg hover:bg-purple-50 transition-colors shadow-lg"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
              </svg>
              Take GTM Assessment
            </a>
            <AuthButtonsCTA variant="signup" />
          </div>
          <div className="mt-6">
            <p className="text-blue-100 text-sm mb-3">Or add Mikey to your team&apos;s Slack:</p>
            <a
              href="/api/slack/oauth"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold py-2 px-5 rounded-lg transition-colors border border-white/20"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
              </svg>
              Add to Slack
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 bg-gray-900 text-gray-400">
        <div className="max-w-4xl mx-auto text-center text-sm">
          <p className="mb-2">
            Mikey is your AI sales coach, powered by Claude and trained on founder-led sales expertise.
          </p>
          <p>
            Built with love for the startup community.
          </p>
        </div>
      </footer>

      {/* Sticky CTA Bar - appears at top when scrolling past hero */}
      <StickyCtaBar />
    </main>
  );
}
