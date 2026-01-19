interface HomeProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const installed = params.installed === "true";
  const workspace = params.workspace as string | undefined;
  const error = params.error as string | undefined;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <img
          src="/mikey-avatar.png"
          alt="Mikey"
          className="w-64 h-64 mx-auto mb-6 rounded-2xl shadow-lg"
        />
        <h1 className="text-4xl font-bold mb-4">Mikey</h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
          Your AI-powered Founder-Led Sales assistant for Slack
        </p>

        {installed && (
          <div className="mb-8 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-green-800 dark:text-green-200">
              Successfully installed to{" "}
              <strong>{workspace || "your workspace"}</strong>! Check your Slack
              for a welcome message from Mikey.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-8 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-200">
              Installation failed: {error}. Please try again.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <a
            href="/api/slack/oauth"
            className="inline-block bg-[#4A154B] hover:bg-[#3a1139] text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Add to Slack
          </a>

          <p className="text-sm text-gray-500">
            Already installed?{" "}
            <a href="/dashboard" className="text-blue-600 hover:underline">
              Go to Dashboard
            </a>
          </p>
        </div>

        <div className="mt-16 text-left">
          <h2 className="text-2xl font-semibold mb-4">What Mikey helps with</h2>
          <ul className="space-y-2 text-gray-600 dark:text-gray-400">
            <li>• Crafting cold outreach messages</li>
            <li>• Handling sales objections</li>
            <li>• Pricing strategy advice</li>
            <li>• Sales call preparation</li>
            <li>• Follow-up sequences</li>
            <li>• And more founder-led sales questions...</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
