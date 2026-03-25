import Link from "next/link";

export function SidebarAdCards() {
  return (
    <>
      <Link
        href="/sales-deck"
        target="_blank"
        className="block mt-4 bg-gradient-to-br from-orange-500 to-pink-500 rounded-xl p-5 text-white shadow-lg hover:shadow-xl transition-shadow"
      >
        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mb-4">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        </div>
        <h3 className="font-bold text-lg mb-1">Sales Deck</h3>
        <p className="text-orange-100 text-sm">
          Create a compelling pitch deck tailored to your narrative and ICP.
        </p>
      </Link>

      <Link
        href="/email-sequence"
        target="_blank"
        className="block mt-4 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl p-5 text-white shadow-lg hover:shadow-xl transition-shadow"
      >
        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mb-4">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="font-bold text-lg mb-1">Outbound Email Sequence</h3>
        <p className="text-emerald-100 text-sm">
          Generate a multi-touch email sequence to engage your ideal prospects.
        </p>
      </Link>

      <Link
        href="/linkedin-sequence"
        target="_blank"
        className="block mt-4 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl p-5 text-white shadow-lg hover:shadow-xl transition-shadow"
      >
        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mb-4">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 className="font-bold text-lg mb-1">Outbound LinkedIn Sequence</h3>
        <p className="text-blue-100 text-sm">
          Build a LinkedIn outreach sequence to connect with decision makers.
        </p>
      </Link>
    </>
  );
}
