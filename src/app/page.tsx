import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StickyCtaBar from "@/components/StickyCtaBar";
import { AuthButtons, AuthButtonsCTA } from "@/components/AuthButtons";

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

      {installed && (
        <div className="max-w-md mx-auto mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">
            Successfully installed to{" "}
            <strong>{workspace || "your workspace"}</strong>! Check your Slack
            for a welcome message from Mikey.
          </p>
        </div>
      )}

      {error && (
        <div className="max-w-md mx-auto mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">
            {error === "workspace_not_found"
              ? "Your workspace hasn't installed Mikey yet. Please install first."
              : error === "not_logged_in"
              ? "Please sign in to continue."
              : `Error: ${error}. Please try again.`}
          </p>
        </div>
      )}

      {/* Hero Section - Assessment Focused */}
      <section className="pt-16 pb-12 px-6">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-medium mb-6">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
            </svg>
            Free GTM Assessment
          </div>

          <h1 className="text-5xl font-bold mb-4 text-gray-900">
            Discover Your GTM Blind Spots
          </h1>
          <p className="text-xl text-gray-600 mb-3">
            Take the GTM Maturity Assessment and get personalized recommendations from Mikey
          </p>
          <p className="text-lg text-gray-500 mb-8 max-w-2xl mx-auto">
            Answer questions about your go-to-market strategy. Get an AI-powered analysis
            based on Pete Kazanjy&apos;s <em>Founding Sales</em> methodology and 15+ years of B2B sales expertise.
          </p>

          {/* Primary CTA - Assessment */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <a
              href="/signin?next=/chat?startAssessment=true"
              className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 text-lg font-semibold text-white rounded-xl overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-xl"
              style={{
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
                backgroundSize: "200% 200%",
              }}
            >
              {/* Animated shimmer effect */}
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
              <span className="relative z-10">Start My Free Assessment</span>
              <svg className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <p className="text-sm text-gray-500">Takes about 10-15 minutes</p>
          </div>

          {/* Secondary CTAs */}
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-gray-500">Or sign up to chat with Mikey directly:</p>
            <AuthButtons variant="signup" />
          </div>
        </div>
      </section>

      {/* Assessment Value Props */}
      <section className="py-16 px-6 bg-gradient-to-b from-purple-50 to-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            What You&apos;ll Get From Your Assessment
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Answer questions across key GTM areas and receive actionable insights tailored to your specific situation.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Card 1: Personalized Analysis */}
            <div className="bg-white rounded-xl p-6 shadow-lg border border-purple-100">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">GTM Maturity Score</h3>
              <p className="text-gray-600">
                Understand where you are across ICP definition, prospecting, sales process, pricing, and team building.
              </p>
            </div>

            {/* Card 2: Priority Recommendations */}
            <div className="bg-white rounded-xl p-6 shadow-lg border border-purple-100">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Priority Actions</h3>
              <p className="text-gray-600">
                Get a prioritized list of what to focus on next based on your stage and biggest gaps.
              </p>
            </div>

            {/* Card 3: Ongoing Guidance */}
            <div className="bg-white rounded-xl p-6 shadow-lg border border-purple-100">
              <div className="w-14 h-14 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Chat With Your Results</h3>
              <p className="text-gray-600">
                Ask follow-up questions about your assessment. Mikey remembers your context and gives relevant advice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Assessment Preview / Sample Questions */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            What We&apos;ll Ask You About
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            The assessment covers the key areas of founder-led sales. No right or wrong answers &mdash; just be honest about where you are.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            {[
              { category: "ICP & Positioning", question: "How clearly have you defined your ideal customer profile?" },
              { category: "Prospecting", question: "What channels are you using to generate leads?" },
              { category: "Sales Process", question: "Do you have a documented sales process with defined stages?" },
              { category: "Pricing", question: "How did you arrive at your current pricing?" },
              { category: "Demos & Presentations", question: "What&apos;s your demo-to-close rate?" },
              { category: "Team Building", question: "Are you ready to hire your first sales rep?" },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-purple-600 font-semibold text-sm">{i + 1}</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-purple-600 mb-1">{item.category}</div>
                  <p className="text-gray-700 text-sm">{item.question}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-gray-500 mt-6 text-sm">
            ...and more across {6} categories of founder-led sales
          </p>
        </div>
      </section>

      {/* Sample Insight Preview */}
      <section className="py-16 px-6 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            Sample Recommendation
          </h2>
          <p className="text-center text-gray-600 mb-10 max-w-2xl mx-auto">
            Here&apos;s an example of the kind of personalized guidance you&apos;ll receive:
          </p>

          {/* Mock Recommendation Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
              <div className="flex items-center gap-3">
                <img src="/mikey-avatar.png" alt="Mikey" className="w-10 h-10 rounded-lg" />
                <div>
                  <h3 className="font-semibold text-white">Mikey&apos;s Analysis</h3>
                  <p className="text-purple-100 text-sm">Based on your assessment</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="prose prose-gray max-w-none">
                <p className="text-gray-700 mb-4">
                  <strong className="text-purple-600">Your biggest opportunity:</strong> Based on your answers,
                  you have strong product-market fit signals but your prospecting is reactive rather than proactive.
                  Here&apos;s what I recommend...
                </p>
                <div className="bg-purple-50 rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                    <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm">1</span>
                    Build a 50-Account Target List
                  </h4>
                  <p className="text-gray-600 text-sm">
                    Start by identifying 50 companies that look like your best customers.
                    Focus on the job title, company size, and industry that matches your wins...
                  </p>
                </div>
                <p className="text-gray-500 text-sm italic">
                  [Continues with 2-3 more specific, actionable recommendations based on your answers...]
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Secondary CTA - Assessment */}
      <section className="py-16 px-6 bg-gradient-to-r from-purple-600 via-blue-600 to-purple-700">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to find your GTM blind spots?
          </h2>
          <p className="text-purple-100 mb-8 text-lg">
            Take the free assessment and get personalized recommendations in minutes.
          </p>
          <a
            href="/signin?next=/chat?startAssessment=true"
            className="inline-flex items-center justify-center gap-3 bg-white text-purple-700 font-semibold py-4 px-8 rounded-xl hover:bg-purple-50 transition-all shadow-lg hover:shadow-xl text-lg"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
            </svg>
            Start My Free Assessment
          </a>
        </div>
      </section>

      {/* What Else Can Mikey Help With - Condensed */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            Beyond the Assessment: Chat with Mikey Anytime
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Get instant answers to your founder-led sales questions &mdash; on the web or in Slack.
          </p>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <div className="bg-gradient-to-br from-blue-50 to-white p-6 rounded-xl border border-blue-100">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-gray-900">Prospecting & Outreach</h3>
              <p className="text-sm text-gray-600">ICP development, cold emails, LinkedIn messaging, outreach sequences</p>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-white p-6 rounded-xl border border-green-100">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-gray-900">Sales Conversations</h3>
              <p className="text-sm text-gray-600">Discovery calls, demos, objection handling, negotiation tactics</p>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-white p-6 rounded-xl border border-purple-100">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-gray-900">Scaling Your Team</h3>
              <p className="text-sm text-gray-600">First sales hire, interview questions, comp plans, onboarding</p>
            </div>
          </div>

          {/* Slack + Web options */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-gray-500">Chat on the web:</p>
              <AuthButtons variant="signup" />
            </div>
            <div className="hidden md:block w-px h-16 bg-gray-200"></div>
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-gray-500">Or add to your team&apos;s Slack:</p>
              <a
                href="/api/slack/oauth"
                className="inline-flex items-center justify-center gap-2 bg-[#4A154B] hover:bg-[#3a1139] text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-md"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                </svg>
                Add to Slack
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Training Content Section - Condensed */}
      <section className="py-16 px-6 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">
            Powered by Proven Methodology
          </h2>
          <p className="text-center text-gray-600 mb-10 max-w-2xl mx-auto">
            Mikey is trained on Pete Kazanjy&apos;s complete body of work and 15+ years of B2B sales expertise.
          </p>

          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-shrink-0">
                <div className="w-28 h-36 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg shadow-md flex items-center justify-center">
                  <span className="text-white text-center font-bold px-3 text-sm">Founding Sales</span>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-3 text-gray-900">
                  The Founding Sales Methodology, Available 24/7
                </h3>
                <p className="text-gray-600 mb-4">
                  <em>Founding Sales</em>, Pete&apos;s essays, class curriculum, templates, real-world sales assets,
                  and interviews &mdash; all distilled into an AI coach that gives you personalized guidance.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Founding Sales Book</span>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Essays & Articles</span>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Templates</span>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">Real Sales Assets</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 bg-gradient-to-r from-purple-600 to-blue-600">
        <div className="max-w-3xl mx-auto text-center">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-24 h-24 mx-auto mb-6 rounded-2xl shadow-lg border-4 border-white/20"
          />
          <h2 className="text-3xl font-bold text-white mb-4">
            Get Your Personalized GTM Roadmap
          </h2>
          <p className="text-purple-100 mb-8 text-lg">
            Take the free assessment. Get actionable recommendations. Level up your founder-led sales.
          </p>
          <a
            href="/signin?next=/chat?startAssessment=true"
            className="inline-flex items-center justify-center gap-3 bg-white text-purple-700 font-semibold py-4 px-8 rounded-xl hover:bg-purple-50 transition-all shadow-lg hover:shadow-xl text-lg"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
            </svg>
            Start My Free Assessment
          </a>
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

      {/* CSS for animations */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </main>
  );
}
