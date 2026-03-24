"use client";

import { useState, useEffect } from "react";
import { getLastAuthMethod, setLastAuthMethod } from "./AuthButtons";

// Google Icon SVG
const GoogleIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// Slack Icon SVG
const SlackIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
  </svg>
);

// Star Icon for Assessment
const StarIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
  </svg>
);

// Last Used Badge
const LastUsedBadge = () => (
  <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] font-medium rounded-full shadow-sm">
    Last Used
  </span>
);

export default function StickyCtaBar() {
  const [isVisible, setIsVisible] = useState(false);
  const [lastUsed, setLastUsed] = useState<"google" | "slack" | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      // Show the sticky bar when user has scrolled past 400px (roughly past the hero CTAs)
      const scrollThreshold = 400;
      setIsVisible(window.scrollY > scrollThreshold);
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // Check initial position

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setLastUsed(getLastAuthMethod());
  }, []);

  const handleGoogleClick = () => {
    setLastAuthMethod("google");
  };

  const handleSlackClick = () => {
    setLastAuthMethod("slack");
  };

  return (
    <div
      className={`fixed top-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 py-3 px-6 z-50 transition-transform duration-300 ${
        isVisible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div className="max-w-4xl mx-auto flex flex-row gap-3 justify-center items-center">
        {/* Primary CTA - Assessment */}
        <a
          href="/signin?next=/chat?startAssessment=true"
          className="inline-flex items-center justify-center gap-2 text-white font-semibold py-2 px-5 rounded-lg transition-all shadow-md text-sm hover:scale-105"
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          }}
        >
          <StarIcon />
          Take Free Assessment
        </a>

        <span className="text-gray-300 dark:text-gray-600">|</span>

        {/* Secondary CTAs - Sign up */}
        <a
          href="/api/auth/slack"
          onClick={handleSlackClick}
          className="relative inline-flex items-center justify-center gap-2 bg-[#4A154B] hover:bg-[#3a1139] text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <SlackIcon />
          Sign Up
          {lastUsed === "slack" && <LastUsedBadge />}
        </a>
        <a
          href="/api/auth/google"
          onClick={handleGoogleClick}
          className="relative inline-flex items-center justify-center gap-2 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <GoogleIcon />
          Sign Up
          {lastUsed === "google" && <LastUsedBadge />}
        </a>
      </div>
    </div>
  );
}
