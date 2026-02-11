"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type VoiceState = "idle" | "listening" | "processing" | "speaking";

interface VoiceModeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSendMessage: (
    message: string,
    onChunk?: (chunk: string, fullText: string) => void
  ) => Promise<string>;
}

// Detect sentence boundaries for chunked TTS
function extractCompleteSentences(text: string): { sentences: string[]; remainder: string } {
  // Match sentences ending with . ! or ? followed by space or end of string
  // Also handle common abbreviations to avoid false positives
  const sentenceRegex = /[^.!?]*[.!?]+(?=\s|$)/g;
  const matches = text.match(sentenceRegex) || [];

  if (matches.length === 0) {
    return { sentences: [], remainder: text };
  }

  const lastMatch = matches[matches.length - 1];
  const lastIndex = text.lastIndexOf(lastMatch) + lastMatch.length;
  const remainder = text.slice(lastIndex).trim();

  return { sentences: matches.map(s => s.trim()), remainder };
}

export function VoiceModeOverlay({ isOpen, onClose, onSendMessage }: VoiceModeOverlayProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [rawTranscript, setRawTranscript] = useState("");
  const [prettifiedTranscript, setPrettifiedTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(9).fill(0.2));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // For streaming TTS
  const audioQueueRef = useRef<Blob[]>([]);
  const isPlayingRef = useRef(false);
  const spokenSentencesRef = useRef<Set<string>>(new Set());
  const accumulatedTextRef = useRef("");

  // Cleanup on unmount or close
  useEffect(() => {
    return () => {
      stopRecording();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, []);

  // Reset state and start recording when overlay opens
  useEffect(() => {
    if (isOpen) {
      setRawTranscript("");
      setPrettifiedTranscript("");
      setResponse("");
      setStreamingText("");
      setError(null);
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      spokenSentencesRef.current = new Set();
      accumulatedTextRef.current = "";
      // Automatically start listening when modal opens
      startRecording();
    } else {
      stopRecording();
      setState("idle");
    }
  }, [isOpen]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  const updateAudioLevels = useCallback(() => {
    if (!analyserRef.current || state !== "listening") return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Sample 9 frequency bands for the visualization
    const bands = 9;
    const bandSize = Math.floor(dataArray.length / bands);
    const levels: number[] = [];

    for (let i = 0; i < bands; i++) {
      let sum = 0;
      for (let j = 0; j < bandSize; j++) {
        sum += dataArray[i * bandSize + j];
      }
      const avg = sum / bandSize / 255;
      levels.push(Math.max(0.15, Math.min(1, avg * 2 + 0.15))); // Scale and clamp
    }

    setAudioLevels(levels);
    animationFrameRef.current = requestAnimationFrame(updateAudioLevels);
  }, [state]);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio analysis for visualization
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // Set up recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType,
        });
        await processRecording(audioBlob);
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setState("listening");

      // Start visualization
      updateAudioLevels();

      // Set up silence detection (stop after 2 seconds of low audio)
      let silenceStart: number | null = null;
      const checkSilence = () => {
        if (state !== "listening" || !analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

        if (avg < 10) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > 2000) {
            // 2 seconds of silence, stop recording
            stopAndProcess();
            return;
          }
        } else {
          silenceStart = null;
        }

        silenceTimeoutRef.current = setTimeout(checkSilence, 100);
      };

      silenceTimeoutRef.current = setTimeout(checkSilence, 1000); // Start checking after 1 second
    } catch (err) {
      console.error("Error starting recording:", err);
      setError("Could not access microphone. Please check permissions.");
      setState("idle");
    }
  };

  const stopAndProcess = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      setState("processing");
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Queue TTS for a sentence
  const queueTTS = async (sentence: string) => {
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence }),
      });

      if (!res.ok) {
        console.error("Failed to generate speech for:", sentence);
        return;
      }

      const audioBlob = await res.blob();
      audioQueueRef.current.push(audioBlob);

      // Start playback if not already playing
      if (!isPlayingRef.current) {
        playNextInQueue();
      }
    } catch (err) {
      console.error("Error queueing TTS:", err);
    }
  };

  // Play next audio in queue
  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      // Check if we're done with everything
      if (state === "speaking" && accumulatedTextRef.current === response) {
        setState("idle");
      }
      return;
    }

    isPlayingRef.current = true;
    const audioBlob = audioQueueRef.current.shift()!;
    const audioUrl = URL.createObjectURL(audioBlob);

    try {
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(audioUrl);
        audioElementRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          reject(new Error("Audio playback failed"));
        };

        audio.play().catch(reject);
      });
    } catch (err) {
      console.error("Error playing audio:", err);
    }

    // Play next in queue
    playNextInQueue();
  };

  // Handle streaming chunks - queue TTS for complete sentences
  const handleStreamChunk = useCallback((chunk: string, fullText: string) => {
    setStreamingText(fullText);
    accumulatedTextRef.current = fullText;

    // Extract complete sentences and queue TTS for new ones
    const { sentences } = extractCompleteSentences(fullText);

    for (const sentence of sentences) {
      if (!spokenSentencesRef.current.has(sentence) && sentence.trim().length > 0) {
        spokenSentencesRef.current.add(sentence);
        queueTTS(sentence);
      }
    }
  }, []);

  const processRecording = async (audioBlob: Blob) => {
    try {
      setState("processing");
      setAudioLevels(Array(9).fill(0.2));

      // Send to transcription API
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const transcribeRes = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!transcribeRes.ok) {
        throw new Error("Failed to transcribe audio");
      }

      const { text: rawText } = await transcribeRes.json();
      setRawTranscript(rawText);

      if (!rawText || rawText.trim().length === 0) {
        setError("No speech detected. Please try again.");
        setState("idle");
        return;
      }

      // Prettify the transcript
      const prettifyRes = await fetch("/api/voice/prettify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: rawText }),
      });

      let messageToSend = rawText;
      if (prettifyRes.ok) {
        const { prettified } = await prettifyRes.json();
        setPrettifiedTranscript(prettified);
        messageToSend = prettified;
      }

      // Reset TTS state
      audioQueueRef.current = [];
      spokenSentencesRef.current = new Set();
      accumulatedTextRef.current = "";

      // Start speaking state and animation
      setState("speaking");
      animateSpeaking();

      // Send message with streaming chunk handler
      const assistantResponse = await onSendMessage(messageToSend, handleStreamChunk);
      setResponse(assistantResponse);

      // Queue any remaining text that wasn't a complete sentence
      const { remainder } = extractCompleteSentences(assistantResponse);
      if (remainder.trim().length > 0) {
        queueTTS(remainder);
      }

      // Wait for audio queue to finish
      while (audioQueueRef.current.length > 0 || isPlayingRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setState("idle");
    } catch (err) {
      console.error("Error processing recording:", err);
      setError("Something went wrong. Please try again.");
      setState("idle");
    }
  };

  const animateSpeaking = () => {
    // Simulate waveform animation during TTS playback
    const animate = () => {
      if (state !== "speaking") return;

      const levels = Array(9)
        .fill(0)
        .map(() => Math.random() * 0.5 + 0.3);
      setAudioLevels(levels);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
  };

  const handleTapToSpeak = () => {
    if (state === "idle") {
      startRecording();
    } else if (state === "listening") {
      stopAndProcess();
    }
  };

  const handleClose = () => {
    stopRecording();
    // Stop any playing audio
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }
    // Clear audio queue to prevent more playback
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    spokenSentencesRef.current = new Set();
    // Stop animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setState("idle");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        // Allow closing by clicking backdrop at any time (stops playback too)
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-3">
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className={`w-9 h-9 rounded-lg transition-all duration-300 ${
                state === "speaking" ? "ring-2 ring-green-500" : ""
              }`}
            />
            <div>
              <h3 className="text-gray-900 font-semibold text-sm">Voice Mode</h3>
              <p className="text-gray-500 text-xs">
                {state === "idle" && "Tap to speak"}
                {state === "listening" && "Listening..."}
                {state === "processing" && "Processing..."}
                {state === "speaking" && "Playing response..."}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {/* Waveform visualization */}
          <div
            className={`flex items-center justify-center gap-1 h-16 mb-4 cursor-pointer rounded-xl mx-auto px-4 ${
              state === "idle" ? "bg-gray-100 hover:bg-gray-200" :
              state === "listening" ? "bg-blue-50" :
              state === "speaking" ? "bg-green-50" :
              "bg-purple-50"
            } transition-colors`}
            onClick={handleTapToSpeak}
          >
            {audioLevels.map((level, i) => (
              <div
                key={i}
                className={`w-1.5 rounded-full transition-all duration-75 ${
                  state === "listening"
                    ? "bg-blue-500"
                    : state === "speaking"
                    ? "bg-green-500"
                    : state === "processing"
                    ? "bg-purple-400 animate-pulse"
                    : "bg-gray-400"
                }`}
                style={{
                  height: `${level * 50}px`,
                  transform: `scaleY(${state === "processing" ? 0.5 : 1})`,
                }}
              />
            ))}
          </div>

          {/* Status indicator */}
          <div className="text-center mb-4">
            {state === "idle" && (
              <p className="text-gray-500 text-sm">Tap the waveform to speak</p>
            )}
            {state === "listening" && (
              <p className="text-blue-600 text-sm animate-pulse">Listening...</p>
            )}
            {state === "processing" && (
              <div className="flex items-center justify-center gap-2 text-purple-600 text-sm">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Mikey is thinking...</span>
              </div>
            )}
            {state === "speaking" && (
              <div className="flex items-center justify-center gap-2 text-green-600 text-sm">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
                <span>Playing response...</span>
              </div>
            )}
          </div>

          {/* Transcript display - compact */}
          {rawTranscript && (
            <div className="bg-gray-50 rounded-lg p-3 mb-2 text-xs">
              <p className="text-gray-400 uppercase tracking-wide mb-1">Transcript:</p>
              <p className="text-gray-600 italic">{rawTranscript}</p>
            </div>
          )}

          {/* Prettified - what was sent */}
          {prettifiedTranscript && prettifiedTranscript !== rawTranscript && (
            <div className="bg-blue-50 rounded-lg p-3 mb-2 text-xs">
              <p className="text-blue-400 uppercase tracking-wide mb-1">Sent to Mikey:</p>
              <p className="text-gray-700">{prettifiedTranscript}</p>
            </div>
          )}

          {/* Streaming response preview during speaking */}
          {state === "speaking" && streamingText && (
            <div className="bg-green-50 rounded-lg p-3 mb-2 text-xs max-h-24 overflow-y-auto">
              <p className="text-green-500 uppercase tracking-wide mb-1">Response:</p>
              <p className="text-gray-700">{streamingText}</p>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="bg-red-50 rounded-lg p-3 text-xs">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          {/* Action hint */}
          {state === "listening" && (
            <p className="text-gray-400 text-xs text-center mt-3">
              Tap again or pause speaking to send
            </p>
          )}

          {/* Response indicator - shows response was received */}
          {response && state === "idle" && (
            <div className="mt-3 pt-3 border-t border-gray-100 text-center">
              <p className="text-green-600 text-xs flex items-center justify-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Response added to chat
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
