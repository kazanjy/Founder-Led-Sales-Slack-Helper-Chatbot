"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type RecordingState = "idle" | "recording" | "committing" | "processing" | "sent";

interface VoiceRecordingInputProps {
  isActive: boolean;
  isSpeaking?: boolean; // TTS is playing Mikey's response
  onCancel: () => void;
  onTranscriptionComplete: (text: string) => void;
  onStopSpeaking?: () => void; // Stop TTS playback
}

const SILENCE_COMMIT_DELAY = 2000; // ms of silence before committing

export function VoiceRecordingInput({
  isActive,
  isSpeaking = false,
  onCancel,
  onTranscriptionComplete,
  onStopSpeaking,
}: VoiceRecordingInputProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [speakingPulse, setSpeakingPulse] = useState(0.5);
  const [commitProgress, setCommitProgress] = useState(0); // 0-100 progress to commit

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speakingAnimationRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const commitAnimationRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false); // Track recording state for callbacks
  const hasSpokenRef = useRef(false); // Track if user has spoken at least once

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
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
    if (commitAnimationRef.current) {
      cancelAnimationFrame(commitAnimationRef.current);
      commitAnimationRef.current = null;
    }
  }, []);

  // Animate speaking pulse
  useEffect(() => {
    if (isSpeaking) {
      const animate = () => {
        setSpeakingPulse(0.4 + Math.random() * 0.4);
        speakingAnimationRef.current = requestAnimationFrame(animate);
      };
      animate();
      return () => {
        if (speakingAnimationRef.current) {
          cancelAnimationFrame(speakingAnimationRef.current);
        }
      };
    }
  }, [isSpeaking]);

  const processRecording = async (audioBlob: Blob) => {
    try {
      setState("processing");

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

      if (!rawText || rawText.trim().length === 0) {
        onCancel();
        return;
      }

      // Prettify the transcript
      const prettifyRes = await fetch("/api/voice/prettify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: rawText }),
      });

      let finalText = rawText;
      if (prettifyRes.ok) {
        const { prettified } = await prettifyRes.json();
        finalText = prettified;
      }

      setState("sent");
      onTranscriptionComplete(finalText);
    } catch (err) {
      console.error("Error processing recording:", err);
      onCancel();
    }
  };

  const stopAndProcess = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      setState("processing");
      setCommitProgress(0);
      silenceStartRef.current = null;
      mediaRecorderRef.current.stop();
    }
  }, []);

  const updateAudioLevelAndCheckSilence = useCallback(() => {
    // Use ref to check if still recording (avoids stale closure issues)
    if (!analyserRef.current || !isRecordingRef.current) {
      return;
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalizedLevel = avg / 255;
    setAudioLevel(normalizedLevel);

    const now = Date.now();
    const SILENCE_THRESHOLD = 15; // Audio level below this is considered silence

    if (avg >= SILENCE_THRESHOLD) {
      // Sound detected - user is speaking
      hasSpokenRef.current = true;
      if (silenceStartRef.current) {
        silenceStartRef.current = null;
        setCommitProgress(0);
        setState("recording");
      }
    } else if (hasSpokenRef.current) {
      // Silence detected, but only start countdown if user has spoken
      if (!silenceStartRef.current) {
        silenceStartRef.current = now;
        setState("committing");
      }

      const silenceDuration = now - silenceStartRef.current;
      const progress = Math.min(100, (silenceDuration / SILENCE_COMMIT_DELAY) * 100);
      setCommitProgress(progress);

      if (silenceDuration >= SILENCE_COMMIT_DELAY) {
        // Commit!
        isRecordingRef.current = false;
        stopAndProcess();
        return;
      }
    }
    // If user hasn't spoken yet and it's silent, just keep listening

    animationFrameRef.current = requestAnimationFrame(updateAudioLevelAndCheckSilence);
  }, [stopAndProcess]);

  const startRecording = async () => {
    try {
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
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4",
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

      mediaRecorder.start(100);
      setState("recording");
      isRecordingRef.current = true;
      hasSpokenRef.current = false; // Reset - wait for user to speak
      silenceStartRef.current = null;
      setCommitProgress(0);

      // Start audio level monitoring with silence detection
      // Small delay to let user start speaking
      setTimeout(() => {
        updateAudioLevelAndCheckSilence();
      }, 300);
    } catch (err) {
      console.error("Error starting recording:", err);
      onCancel();
    }
  };

  const handleCancel = () => {
    stopRecording();
    setState("idle");
    setCommitProgress(0);
    silenceStartRef.current = null;
    if (onStopSpeaking) onStopSpeaking();
    onCancel();
  };

  // Start recording when component becomes active (and not speaking)
  useEffect(() => {
    if (isActive && state === "idle" && !isSpeaking) {
      startRecording();
    } else if (!isActive && !isSpeaking) {
      stopRecording();
      setState("idle");
      setCommitProgress(0);
    }
  }, [isActive, isSpeaking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (speakingAnimationRef.current) {
        cancelAnimationFrame(speakingAnimationRef.current);
      }
    };
  }, [stopRecording]);

  if (!isActive && !isSpeaking) return null;

  const pulseScale = isSpeaking ? 1 + speakingPulse * 0.3 : 1 + audioLevel * 0.5;
  const isRecordingActive = (state === "recording" || state === "committing") && !isSpeaking;
  const isCommitting = state === "committing" && !isSpeaking;
  const isProcessingActive = state === "processing" && !isSpeaking;
  const isSentActive = state === "sent" && !isSpeaking;

  // Determine colors based on state
  const getBgColor = () => {
    if (isSpeaking) return "bg-green-50 border-green-200";
    if (isCommitting) return "bg-orange-50 border-orange-200";
    if (isSentActive) return "bg-blue-50 border-blue-200";
    return "bg-purple-50 border-purple-200";
  };

  const getIconBgColor = () => {
    if (isSpeaking) return "bg-green-600 text-white";
    if (isCommitting) return "bg-orange-500 text-white";
    if (isSentActive) return "bg-blue-600 text-white";
    if (state === "recording") return "bg-purple-600 text-white";
    return "bg-purple-100 text-purple-600";
  };

  const getPulseColor = () => {
    if (isSpeaking) return "bg-green-400";
    if (isCommitting) return "bg-orange-400";
    return "bg-purple-400";
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border rounded-lg transition-colors duration-150 ${getBgColor()}`}>
      {/* Pulsing icon with commit progress ring */}
      <div className="relative flex items-center justify-center">
        {/* Commit progress ring */}
        {isCommitting && (
          <svg className="absolute w-12 h-12 -rotate-90" viewBox="0 0 48 48">
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="#fdba74"
              strokeWidth="3"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="#f97316"
              strokeWidth="3"
              strokeDasharray={`${(commitProgress / 100) * 125.6} 125.6`}
              strokeLinecap="round"
            />
          </svg>
        )}

        {/* Pulse rings - show for recording OR speaking (not committing) */}
        {((state === "recording" && !isCommitting) || isSpeaking) && (
          <>
            <div
              className={`absolute w-10 h-10 rounded-full ${getPulseColor()} opacity-20 animate-ping`}
              style={{ animationDuration: isSpeaking ? "1s" : "1.5s" }}
            />
            <div
              className={`absolute w-8 h-8 rounded-full ${getPulseColor()} opacity-30 transition-transform duration-75`}
              style={{ transform: `scale(${pulseScale})` }}
            />
          </>
        )}

        <div
          className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-150 ${getIconBgColor()}`}
        >
          {isProcessingActive ? (
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : isSentActive ? (
            // Checkmark for sent
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : isSpeaking ? (
            // Speaker icon for TTS playback
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          ) : (
            // Microphone icon for recording
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Status text */}
      <div className="flex-1">
        {isSpeaking && (
          <p className="text-green-700 font-medium">
            Mikey is speaking...
          </p>
        )}
        {state === "recording" && !isCommitting && !isSpeaking && (
          <p className="text-purple-700 font-medium">
            Listening...
          </p>
        )}
        {isCommitting && (
          <p className="text-orange-600 font-medium">
            Preparing to send...
          </p>
        )}
        {isProcessingActive && (
          <p className="text-purple-600 font-medium">Processing...</p>
        )}
        {isSentActive && (
          <p className="text-blue-600 font-medium">Sent! Waiting for response...</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {isRecordingActive && (
          <button
            type="button"
            onClick={stopAndProcess}
            className={`px-3 py-1.5 text-white text-sm font-medium rounded-lg transition-colors ${
              isCommitting
                ? "bg-orange-500 hover:bg-orange-600"
                : "bg-purple-600 hover:bg-purple-700"
            }`}
          >
            Send
          </button>
        )}
        {isSpeaking && onStopSpeaking && (
          <button
            type="button"
            onClick={onStopSpeaking}
            className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={handleCancel}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Close"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
