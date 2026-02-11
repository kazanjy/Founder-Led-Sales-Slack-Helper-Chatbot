"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type RecordingState = "idle" | "recording" | "processing";

interface VoiceRecordingInputProps {
  isActive: boolean;
  onCancel: () => void;
  onTranscriptionComplete: (text: string) => void;
}

export function VoiceRecordingInput({
  isActive,
  onCancel,
  onTranscriptionComplete,
}: VoiceRecordingInputProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(() => {
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
  }, []);

  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current || state !== "recording") return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
    setAudioLevel(avg);

    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, [state]);

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

      onTranscriptionComplete(finalText);
    } catch (err) {
      console.error("Error processing recording:", err);
      onCancel();
    }
  };

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

      // Start visualization
      updateAudioLevel();

      // Set up silence detection (stop after 2 seconds of low audio)
      let silenceStart: number | null = null;
      const checkSilence = () => {
        if (state !== "recording" || !analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

        if (avg < 10) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > 2000) {
            stopAndProcess();
            return;
          }
        } else {
          silenceStart = null;
        }

        silenceTimeoutRef.current = setTimeout(checkSilence, 100);
      };

      silenceTimeoutRef.current = setTimeout(checkSilence, 1000);
    } catch (err) {
      console.error("Error starting recording:", err);
      onCancel();
    }
  };

  const stopAndProcess = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      setState("processing");
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleCancel = () => {
    stopRecording();
    setState("idle");
    onCancel();
  };

  // Start recording when component becomes active
  useEffect(() => {
    if (isActive && state === "idle") {
      startRecording();
    } else if (!isActive) {
      stopRecording();
      setState("idle");
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  if (!isActive) return null;

  const pulseScale = 1 + audioLevel * 0.5;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg">
      {/* Pulsing microphone icon */}
      <div className="relative flex items-center justify-center">
        {/* Pulse rings */}
        {state === "recording" && (
          <>
            <div
              className="absolute w-10 h-10 rounded-full bg-purple-400 opacity-20 animate-ping"
              style={{ animationDuration: "1.5s" }}
            />
            <div
              className="absolute w-8 h-8 rounded-full bg-purple-500 opacity-30 transition-transform duration-75"
              style={{ transform: `scale(${pulseScale})` }}
            />
          </>
        )}
        <div
          className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center ${
            state === "recording"
              ? "bg-purple-600 text-white"
              : "bg-purple-100 text-purple-600"
          }`}
        >
          {state === "processing" ? (
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
          ) : (
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
        {state === "recording" && (
          <p className="text-purple-700 font-medium">
            Listening... <span className="text-purple-500 text-sm">(tap to send, or pause speaking)</span>
          </p>
        )}
        {state === "processing" && (
          <p className="text-purple-600">Processing...</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {state === "recording" && (
          <button
            type="button"
            onClick={stopAndProcess}
            className="px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
          >
            Send
          </button>
        )}
        <button
          type="button"
          onClick={handleCancel}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Cancel"
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
