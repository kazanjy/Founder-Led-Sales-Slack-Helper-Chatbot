"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface User {
  id: string;
  licenseStatus: string;
}

export default function UpgradeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled") === "true";
  const installed = searchParams.get("installed") === "true";
  const workspace = searchParams.get("workspace");

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "annual">("annual");
  const [error, setError] = useState<string | null>(null);

  // Check if user is authenticated
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user || null);
        // If user is already subscribed, redirect to chat
        if (data.user?.licenseStatus === "ACTIVE") {
          router.push("/chat");
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [router]);

  const handleCheckout = async () => {
    if (!user) {
      // Redirect to sign in
      window.location.href = "/api/auth/slack";
      return;
    }

    setCheckoutLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan }),
      });

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("No checkout URL returned:", data);
        setError(data.error || "Failed to create checkout session. Please try again.");
        setCheckoutLoading(false);
      }
    } catch (err) {
      console.error("Checkout error:", err);
      setError("Network error. Please check your connection and try again.");
      setCheckoutLoading(false);
    }
  };

  const handleSkip = () => {
    if (user) {
      router.push("/chat");
    } else {
      router.push("/");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Loading...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-gray-50">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-24 h-24 mx-auto mb-4 rounded-2xl shadow-lg"
          />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {installed ? "Mikey is installed!" : "Upgrade to Mikey Pro"}
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            {installed && workspace
              ? `Successfully added to ${workspace}. `
              : ""}
            Unlock unlimited access to your Founder-Led Sales assistant
          </p>
        </div>

        {canceled && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
            <p className="text-yellow-800">
              Checkout was canceled. No worries - you can try again anytime!
            </p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-center">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {/* Monthly Plan */}
          <button
            onClick={() => setSelectedPlan("monthly")}
            className={`p-6 rounded-xl border-2 text-left transition-all ${
              selectedPlan === "monthly"
                ? "border-blue-600 bg-blue-50"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Monthly</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Pay as you go</p>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selectedPlan === "monthly"
                    ? "border-blue-600 bg-blue-600"
                    : "border-gray-300 dark:border-gray-700"
                }`}
              >
                {selectedPlan === "monthly" && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </div>
            <div className="mb-2">
              <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">$99</span>
              <span className="text-gray-500 dark:text-gray-400">/month</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Cancel anytime</p>
          </button>

          {/* Annual Plan */}
          <button
            onClick={() => setSelectedPlan("annual")}
            className={`p-6 rounded-xl border-2 text-left transition-all relative ${
              selectedPlan === "annual"
                ? "border-blue-600 bg-blue-50"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
            }`}
          >
            {/* Save badge */}
            <div className="absolute -top-3 left-4 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded-full">
              Save 30%
            </div>

            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Annual</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Best value</p>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selectedPlan === "annual"
                    ? "border-blue-600 bg-blue-600"
                    : "border-gray-300 dark:border-gray-700"
                }`}
              >
                {selectedPlan === "annual" && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </div>
            <div className="mb-2">
              <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">$69</span>
              <span className="text-gray-500 dark:text-gray-400">/month</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Billed annually ($828/year)
            </p>
          </button>
        </div>

        {/* What's included */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-8">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
            What&apos;s included:
          </h3>
          <ul className="space-y-3">
            {[
              "Unlimited conversations with Mikey",
              "Access via Slack and web app",
              "Full chat history",
              "Priority support",
            ].map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <svg
                  className="w-5 h-5 text-green-500 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-gray-700 dark:text-gray-200">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleCheckout}
            disabled={checkoutLoading}
            className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors"
          >
            {checkoutLoading
              ? "Redirecting to checkout..."
              : user
              ? "Continue to Payment"
              : "Sign in with Slack to Subscribe"}
          </button>

          <button
            onClick={handleSkip}
            className="w-full py-3 px-6 text-gray-400 hover:text-gray-600 font-medium transition-colors"
          >
            Skip for now
          </button>
        </div>

        {/* Trust signals */}
        <p className="text-center text-sm text-gray-400 mt-6">
          Secure payment powered by Stripe. Cancel anytime.
        </p>
      </div>
    </main>
  );
}
