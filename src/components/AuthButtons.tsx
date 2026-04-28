"use client";

import { useEffect, useState } from "react";

const LAST_AUTH_METHOD_KEY = "mikey_last_auth_method";

type AuthMethod = "google" | "slack" | null;

interface AuthButtonsProps {
  variant?: "signup" | "signin";
  className?: string;
}

// Google Icon SVG
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// Slack Icon SVG
const SlackIcon = ({ className = "w-5 h-5", fill = "#4A154B" }: { className?: string; fill?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill={fill}>
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
  </svg>
);

// Last Used Badge
const LastUsedBadge = () => (
  <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] font-medium rounded-full shadow-sm">
    Last Used
  </span>
);

// Track which method was used
export function setLastAuthMethod(method: AuthMethod) {
  if (typeof window !== "undefined" && method) {
    localStorage.setItem(LAST_AUTH_METHOD_KEY, method);
  }
}

export function getLastAuthMethod(): AuthMethod {
  if (typeof window === "undefined") return null;
  const method = localStorage.getItem(LAST_AUTH_METHOD_KEY);
  if (method === "google" || method === "slack") {
    return method;
  }
  return null;
}

export function AuthButtons({ variant = "signup", className = "" }: AuthButtonsProps) {
  const [lastUsed, setLastUsed] = useState<AuthMethod>(null);

  useEffect(() => {
    setLastUsed(getLastAuthMethod());
  }, []);

  const actionText = variant === "signin" ? "Sign in" : "Sign up";

  const handleGoogleClick = () => {
    setLastAuthMethod("google");
  };

  const handleSlackClick = () => {
    setLastAuthMethod("slack");
  };

  return (
    <div className={`flex flex-col sm:flex-row gap-3 ${className}`}>
      <a
        href="/api/auth/google"
        onClick={handleGoogleClick}
        className="relative inline-flex items-center justify-center gap-2 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold py-3 px-6 rounded-lg transition-colors"
      >
        <GoogleIcon />
        {actionText} with Google
        {lastUsed === "google" && <LastUsedBadge />}
      </a>
      <a
        href="/api/auth/slack"
        onClick={handleSlackClick}
        className="relative inline-flex items-center justify-center gap-2 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold py-3 px-6 rounded-lg transition-colors"
      >
        <SlackIcon />
        {actionText} with Slack
        {lastUsed === "slack" && <LastUsedBadge />}
      </a>
    </div>
  );
}

// Variant for the bottom CTA section (different styling)
export function AuthButtonsCTA({ variant = "signup" }: { variant?: "signup" | "signin" }) {
  const [lastUsed, setLastUsed] = useState<AuthMethod>(null);

  useEffect(() => {
    setLastUsed(getLastAuthMethod());
  }, []);

  const actionText = variant === "signin" ? "Sign in" : "Sign up";

  const handleGoogleClick = () => {
    setLastAuthMethod("google");
  };

  const handleSlackClick = () => {
    setLastAuthMethod("slack");
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <a
        href="/api/auth/google"
        onClick={handleGoogleClick}
        className="relative inline-flex items-center justify-center gap-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold py-3 px-6 rounded-lg hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors"
      >
        <GoogleIcon />
        {actionText} with Google
        {lastUsed === "google" && <LastUsedBadge />}
      </a>
      <a
        href="/api/auth/slack"
        onClick={handleSlackClick}
        className="relative inline-flex items-center justify-center gap-2 bg-transparent border-2 border-white text-white font-semibold py-3 px-6 rounded-lg hover:bg-white/10 transition-colors"
      >
        <SlackIcon className="w-5 h-5" fill="currentColor" />
        {actionText} with Slack
        {lastUsed === "slack" && (
          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-white dark:bg-gray-800 text-blue-600 text-[10px] font-medium rounded-full shadow-sm">
            Last Used
          </span>
        )}
      </a>
    </div>
  );
}
