"use client";

import { useEffect, useRef, useState } from "react";

interface VoiceNoteButtonProps {
  /** Called once the recording has been transcribed AND synthesized. */
  onResult: (summary: string, rawTranscript: string) => void;
  /** Disable starting a new recording (e.g. while a parent form is busy). */
  disabled?: boolean;
  /**
   * "icon" (default) renders a compact mic glyph for the textarea
   * action row. "prominent" renders a gradient pill suitable for the
   * entry-type tab row up top — same logic, different surface, used
   * to merchandise the feature.
   */
  variant?: "icon" | "prominent";
}

type State = "idle" | "recording" | "transcribing" | "synthesizing";

/**
 * Single-button voice-note recorder for the Deals timeline. Tap to
 * start, tap to stop. After stopping it pipes the audio through
 * /api/voice/transcribe (Whisper) → /api/voice/synthesize-deal-note
 * (GPT) and hands the parent both the cleaned summary and the raw
 * transcript so it can show the latter behind a reveal link.
 *
 * Intentionally NOT reusing VoiceRecordingInput from chat — that
 * component auto-commits on silence, which is wrong for someone
 * dictating a deal memo who may pause to think.
 */
export function VoiceNoteButton({ onResult, disabled, variant = "icon" }: VoiceNoteButtonProps) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  // Tick a 1s elapsed-time counter while recording.
  useEffect(() => {
    if (state === "recording") {
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [state]);

  // Stop the mic stream cleanly on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  const start = async () => {
    if (state !== "idle" || disabled) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start();
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setState("recording");
    } catch (err) {
      console.error("Mic permission / device error:", err);
      setError("Microphone access denied. Enable it in your browser settings.");
    }
  };

  const stop = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleStop = async () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState("transcribing");

    try {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
      const fd = new FormData();
      fd.append("audio", blob, "voice-note.webm");
      const tRes = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
      if (!tRes.ok) throw new Error("Transcription failed");
      const { text } = await tRes.json();
      const transcript = (text || "").trim();
      if (!transcript) throw new Error("No speech detected — try again.");

      setState("synthesizing");
      const sRes = await fetch("/api/voice/synthesize-deal-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!sRes.ok) throw new Error("Synthesis failed");
      const { summary } = await sRes.json();

      onResult((summary || "").trim(), transcript);
    } catch (err) {
      console.error("Voice note pipeline error:", err);
      setError(err instanceof Error ? err.message : "Voice note failed.");
    } finally {
      setState("idle");
    }
  };

  const isBusy = state === "transcribing" || state === "synthesizing";
  const label =
    state === "recording" ? `Stop (${elapsedSec}s)` :
    state === "transcribing" ? "Transcribing…" :
    state === "synthesizing" ? "Synthesizing…" :
    "Voice note";

  if (variant === "prominent") {
    // Tab-row treatment: distinctive gradient pill that sits next to
    // the entry-type buttons. Same recording machinery, more visible
    // surface so the feature gets noticed.
    return (
      <div className="relative inline-flex items-center group">
        <button
          type="button"
          onClick={state === "recording" ? stop : start}
          disabled={disabled || isBusy}
          aria-label={label}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1.5 shadow-sm ${
            state === "recording"
              ? "bg-red-600 text-white hover:bg-red-700"
              : isBusy
              ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
              : "bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:from-purple-700 hover:to-pink-600 hover:shadow"
          } disabled:opacity-50`}
        >
          {state === "recording" ? (
            <>
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              Stop ({elapsedSec}s)
            </>
          ) : isBusy ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {state === "transcribing" ? "Transcribing…" : "Synthesizing…"}
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-9a3 3 0 01-3-3V5a3 3 0 016 0v5a3 3 0 01-3 3z" />
              </svg>
              🎤 Voice Note
            </>
          )}
        </button>
        {/* Match the CSS tooltip pattern used by the other entry-type
            chips. Hide it once recording / processing has started since
            the button label is communicating state directly at that
            point. */}
        {state === "idle" && (
          <span
            role="tooltip"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-20 w-56 px-2.5 py-1.5 rounded-md bg-gray-900 text-white text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-75"
          >
            Record a voice note — Mikey transcribes it and synthesizes a clean deal note for you to review.
          </span>
        )}
        {error && (
          <span className="ml-2 text-[11px] text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className="relative inline-flex items-center group/voice">
      <button
        type="button"
        onClick={state === "recording" ? stop : start}
        disabled={disabled || isBusy}
        title="Record a voice note — Mikey transcribes and synthesizes it"
        aria-label={label}
        className={`p-1.5 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1 ${
          state === "recording"
            ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300"
            : isBusy
            ? "bg-purple-50 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
            : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        } disabled:opacity-50`}
      >
        {state === "recording" ? (
          <>
            <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
            <span>{elapsedSec}s</span>
          </>
        ) : isBusy ? (
          <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-9a3 3 0 01-3-3V5a3 3 0 016 0v5a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>
      {error && (
        <span className="ml-2 text-[11px] text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
