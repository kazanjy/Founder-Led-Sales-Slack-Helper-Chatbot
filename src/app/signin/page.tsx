import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthButtons } from "@/components/AuthButtons";

export default async function SignInPage() {
  // Check if user is already logged in
  const user = await getCurrentUser();
  if (user) {
    redirect("/chat");
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50 flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-10 h-10 rounded-lg"
            />
            <span className="font-bold text-xl text-gray-900">Mikey</span>
          </a>
        </div>
      </header>

      {/* Sign In Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <div className="text-center mb-8">
              <img
                src="/mikey-avatar.png"
                alt="Mikey"
                className="w-20 h-20 mx-auto mb-4 rounded-xl"
              />
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Sign in to Mikey
              </h1>
              <p className="text-gray-600">
                Your AI-powered Founder-Led Sales assistant
              </p>
            </div>

            <AuthButtons variant="signin" className="flex-col" />

            <div className="mt-8 pt-6 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-500">
                Don&apos;t have an account?{" "}
                <a href="/" className="text-blue-600 hover:underline font-medium">
                  Sign up
                </a>
              </p>
            </div>
          </div>

          {/* Add to Slack Workspace option */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500 mb-3">
              Want to add Mikey to your team&apos;s Slack workspace?
            </p>
            <a
              href="/api/slack/oauth"
              className="inline-flex items-center justify-center gap-2 text-[#4A154B] hover:underline font-medium text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
              </svg>
              Add to Slack Workspace
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 px-6 text-center text-sm text-gray-400">
        <p>Mikey - Your AI Founder-Led Sales Coach</p>
      </footer>
    </main>
  );
}
