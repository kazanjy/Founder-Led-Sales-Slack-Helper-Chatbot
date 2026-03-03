"use client";

import { useState, useEffect, useRef } from "react";

interface AttachmentInfo {
  id: string;
  name: string;
  isAvailable: boolean;
  appUrl: string;
}

interface AttachmentPickerProps {
  selectedAttachments: string[];
  onSelectionChange: (attachments: string[]) => void;
  disabled?: boolean;
  isFirstMessage: boolean; // Only show picker for first message
}

const ATTACHMENT_METADATA: Record<string, { name: string; appPath: string }> = {
  salesNarrative: { name: "Sales Narrative", appPath: "/sales-narrative" },
  gtmAssessment: { name: "GTM Assessment", appPath: "/assessment" },
  discoveryQuestions: { name: "Discovery Questions", appPath: "/discovery-questions" },
  firstCallChecklist: { name: "First Call Checklist", appPath: "/first-call-checklist" },
  preCallPlanning: { name: "Pre-Call Planning Process", appPath: "/pre-call-planning" },
};

export function AttachmentPicker({
  selectedAttachments,
  onSelectionChange,
  disabled = false,
  isFirstMessage,
}: AttachmentPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available attachments
  useEffect(() => {
    async function fetchAttachments() {
      try {
        const res = await fetch("/api/attachments/available");
        if (res.ok) {
          const data = await res.json();
          setAttachments(data.attachments || []);
        }
      } catch (error) {
        console.error("Failed to fetch attachments:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchAttachments();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleAttachment = (attachmentId: string) => {
    if (selectedAttachments.includes(attachmentId)) {
      onSelectionChange(selectedAttachments.filter((id) => id !== attachmentId));
    } else {
      onSelectionChange([...selectedAttachments, attachmentId]);
    }
  };

  const removeAttachment = (attachmentId: string) => {
    onSelectionChange(selectedAttachments.filter((id) => id !== attachmentId));
  };

  // Don't render if not first message
  if (!isFirstMessage) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading}
        className={`p-2 rounded-lg transition-colors ${
          isOpen || selectedAttachments.length > 0
            ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        title="Attach context"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        {selectedAttachments.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center">
            {selectedAttachments.length}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="px-3 py-2 border-b border-gray-100">
            <h3 className="font-medium text-gray-900 text-sm">Attach Context</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Include your GTM outputs with this message
            </p>
          </div>
          <div className="py-1">
            {loading ? (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                Loading...
              </div>
            ) : (
              attachments.map((attachment) => {
                const isSelected = selectedAttachments.includes(attachment.id);
                return (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => {
                      if (attachment.isAvailable) {
                        toggleAttachment(attachment.id);
                      } else {
                        // Navigate to the app to complete it
                        window.location.href = attachment.appUrl;
                      }
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center ${
                          isSelected
                            ? "bg-blue-600 border-blue-600"
                            : "border-gray-300"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <span
                        className={`text-sm ${
                          attachment.isAvailable ? "text-gray-900" : "text-gray-400"
                        }`}
                      >
                        {attachment.name}
                      </span>
                    </div>
                    {attachment.isAvailable ? (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Ready
                      </span>
                    ) : (
                      <span className="text-xs text-blue-600 hover:underline">
                        Start →
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {selectedAttachments.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 rounded-b-lg">
              <p className="text-xs text-gray-500">
                {selectedAttachments.length} attachment
                {selectedAttachments.length !== 1 ? "s" : ""} will be included
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Editable chips component for showing selected attachments above input
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: string[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((attachmentId) => {
        const meta = ATTACHMENT_METADATA[attachmentId];
        if (!meta) return null;
        return (
          <div
            key={attachmentId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-sm border border-blue-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span>{meta.name}</span>
            <button
              type="button"
              onClick={() => onRemove(attachmentId)}
              className="ml-0.5 hover:text-blue-900 focus:outline-none"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Chips component for showing attachments that were already sent
export function AttachmentChipsReadOnly({ attachments }: { attachments: string[] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((attachmentId) => {
        const meta = ATTACHMENT_METADATA[attachmentId];
        if (!meta) return null;
        return (
          <div
            key={attachmentId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-sm border border-green-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{meta.name}</span>
            <span className="text-green-600 text-xs">included</span>
          </div>
        );
      })}
    </div>
  );
}
