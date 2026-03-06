"use client";

import { useState, useEffect } from "react";

interface GeneratingOverlayProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  emojis?: string[];
  messages?: string[];
  /** For SSE-style progress (0-100). If provided, shows a progress bar. */
  progress?: { message: string; progress: number } | null;
}

const DEFAULT_EMOJIS = ["✨", "🚀", "💡"];

const FUN_FACTS = [
  "The average B2B sale involves 6-10 decision makers.",
  "80% of sales require 5+ follow-up calls after a meeting.",
  "Personalized emails get 6x higher transaction rates.",
  "Top salespeople spend 6+ hours per week researching prospects.",
  "Companies that respond within 5 minutes are 100x more likely to connect.",
  "92% of all customer interactions happen over the phone.",
  "Only 2% of cold calls result in an appointment.",
  "Referred customers have a 16% higher lifetime value.",
  "Thursday is the best day to prospect.",
  "It takes an average of 8 touches to get a meeting with a prospect.",
  "Social selling leaders create 45% more opportunities.",
  "Nurtured leads make 47% larger purchases.",
  "50% of buyers choose the vendor that responds first.",
  "Video messages in email boost click-through rates by 300%.",
  "Asking 11-14 questions on a discovery call correlates with success.",
];

export function GeneratingOverlay({
  visible,
  title,
  subtitle,
  emojis = DEFAULT_EMOJIS,
  messages = [],
  progress,
}: GeneratingOverlayProps) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [factIndex, setFactIndex] = useState(() => Math.floor(Math.random() * FUN_FACTS.length));
  const [dots, setDots] = useState("");

  // Rotate loading messages
  useEffect(() => {
    if (!visible || messages.length === 0) return;
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [visible, messages.length]);

  // Rotate fun facts
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setFactIndex((prev) => (prev + 1) % FUN_FACTS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [visible]);

  // Animated dots
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 500);
    return () => clearInterval(interval);
  }, [visible]);

  // Reset on show
  useEffect(() => {
    if (visible) {
      setMessageIndex(0);
      setFactIndex(Math.floor(Math.random() * FUN_FACTS.length));
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-700 text-white">
      {/* Floating background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/5"
            style={{
              width: `${60 + i * 40}px`,
              height: `${60 + i * 40}px`,
              left: `${10 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animation: `float ${4 + i}s ease-in-out infinite alternate`,
              animationDelay: `${i * 0.7}s`,
            }}
          />
        ))}
      </div>

      {/* Bouncing emojis */}
      <div className="flex gap-4 text-5xl mb-8 relative">
        {emojis.map((emoji, i) => (
          <span
            key={i}
            className="animate-bounce"
            style={{ animationDelay: `${i * 0.2}s`, animationDuration: "1s" }}
          >
            {emoji}
          </span>
        ))}
      </div>

      {/* Spinner rings */}
      <div className="relative w-20 h-20 mb-8">
        <div className="absolute inset-0 border-4 border-white/20 rounded-full" />
        <div className="absolute inset-0 border-4 border-transparent border-t-white rounded-full animate-spin" />
        <div
          className="absolute inset-2 border-4 border-transparent border-t-white/60 rounded-full animate-spin"
          style={{ animationDirection: "reverse", animationDuration: "1.5s" }}
        />
      </div>

      {/* Title */}
      <h3 className="text-2xl font-bold mb-4 text-center px-6">{title}</h3>

      {/* Progress bar (for SSE-style progress) */}
      {progress && (
        <div className="w-72 mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-white/80">{progress.message}</span>
            <span className="text-sm text-white/50">{progress.progress}%</span>
          </div>
          <div className="w-full bg-white/20 rounded-full h-2.5">
            <div
              className="bg-white h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Rotating loading message */}
      {messages.length > 0 && (
        <div className="h-8 flex items-center justify-center">
          <p className="text-lg text-white/90 animate-pulse">
            {messages[messageIndex]}{dots}
          </p>
        </div>
      )}

      {/* Subtitle */}
      {subtitle && (
        <p className="text-sm text-white/60 mt-4 text-center px-6">{subtitle}</p>
      )}

      {/* Fun fact */}
      <div className="absolute bottom-12 left-0 right-0 flex justify-center px-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-xl px-6 py-3 max-w-md text-center">
          <p className="text-xs text-white/50 mb-1 font-medium uppercase tracking-wider">Did you know?</p>
          <p className="text-sm text-white/80 transition-opacity duration-500">
            {FUN_FACTS[factIndex]}
          </p>
        </div>
      </div>

      {/* CSS for floating animation */}
      <style>{`
        @keyframes float {
          from { transform: translateY(0px) scale(1); opacity: 0.3; }
          to { transform: translateY(-30px) scale(1.1); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
