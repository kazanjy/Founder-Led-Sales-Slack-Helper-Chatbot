"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { DEFAULT_PROMPTS } from "@/lib/default-prompts";
import { MaturityQuizModal } from "@/components/MaturityQuizModal";
import { MaturityAssessmentWidget } from "@/components/MaturityAssessmentWidget";
import { TruncatedUserMessage } from "@/components/TruncatedUserMessage";

import ProfileCompletionModal from "@/components/ProfileCompletionModal";
import GetStartedModal from "@/components/GetStartedModal";
import GoogleConnectionModal from "@/components/GoogleConnectionModal";
import { VoiceRecordingInput } from "@/components/VoiceRecordingInput";
import { copyMarkdownAsRichText, copyMessagesAsRichText } from "@/lib/clipboard";
import { AttachmentPicker, AttachmentChips, AttachmentChipsReadOnly } from "@/components/AttachmentPicker";
import { FileAttachmentButton as ImageAttachmentButton, FilePreviewChips as ImagePreviewChips, ImageChipsReadOnly, isPDFFile, isCSVFile, isSupportedFile, type AttachedFile } from "@/components/ImageAttachment";
import Papa from "papaparse";
import { convertPDFToImages } from "@/lib/pdf-to-images";
import { Lightbox, type LightboxImage } from "@/components/Lightbox";
import { useConfirmModal } from "@/components/useConfirmModal";
import { ShareChatModal } from "@/components/ShareChatModal";
import SalesNavBar from "@/components/SalesNavBar";

// Simple merge field detection (matches server-side logic)
function findMergeFields(text: string): string[] {
  const matches = text.match(/\{\{([A-Z_]+)\}\}/g) || [];
  return matches.map(m => m.replace(/[{}]/g, ''));
}

// Expand merge fields in text using provided variables
function expandMergeFieldsInText(text: string, variables: { mergeField: string; value: string | null }[]): string {
  const variableMap = new Map(variables.map(v => [v.mergeField, v.value]));
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (match, fieldName) => {
    const value = variableMap.get(fieldName);
    return value || match; // Keep original if no value
  });
}

interface GtmVariable {
  mergeField: string;
  name: string;
  value: string | null;
}

// Saved Prompt interface (matches API response)
interface SavedPrompt {
  id: string;
  emoji: string;
  title: string;
  prompt: string;
  defaultPromptId: string | null; // Tracks if this was originally a default prompt
}

/**
 * Format a date as relative time (e.g., "2m ago", "3h ago", "Yesterday", "Jan 15")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return "Just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    // Show month and day for older messages
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  workspaceName: string | null;
  licenseStatus: string;
  trialDaysRemaining: number;
  canChat: boolean;
  chatBlockedMessage: string;
  isGoogleUser: boolean;
  isSlackUser: boolean;
  isImpersonating: boolean;
  missingName?: boolean;
  missingEmail?: boolean;
}

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

// Stored file reference from database (storage paths, not base64)
interface StoredFileRef {
  name: string;
  type: "image" | "pdf" | "csv";
  storagePath: string;
  pageCount?: number;
}

// Loaded file with signed URLs (for display)
interface LoadedFile {
  name: string;
  type: "image" | "pdf" | "csv";
  url?: string; // For images
  pageUrls?: string[]; // For PDFs
  pageCount?: number;
}

// Extract image/PDF references from message content and find matching files
// Checks loadedFiles (signed URLs) first, then falls back to pendingFiles (base64)
function getMessageFiles(
  messageContent: string,
  loadedFiles: LoadedFile[],
  pendingFiles: AttachedFile[] = []
): LoadedFile[] {
  // Match [Image: filename], [PDF: filename], and [CSV: filename] patterns
  const imagePattern = /\[Image: ([^\]]+)\]/g;
  const pdfPattern = /\[PDF: ([^\]]+)\]/g;
  const csvPattern = /\[CSV: ([^\]]+)\]/g;

  const referencedNames: string[] = [];

  let match;
  while ((match = imagePattern.exec(messageContent)) !== null) {
    referencedNames.push(match[1]);
  }
  while ((match = pdfPattern.exec(messageContent)) !== null) {
    referencedNames.push(match[1]);
  }
  while ((match = csvPattern.exec(messageContent)) !== null) {
    referencedNames.push(match[1]);
  }

  // Build result array, preferring loadedFiles (signed URLs) over pendingFiles (base64)
  const result: LoadedFile[] = [];
  const loadedByName = new Map(loadedFiles.map(f => [f.name, f]));

  for (const name of referencedNames) {
    // First check loadedFiles (already uploaded with signed URLs)
    const loaded = loadedByName.get(name);
    if (loaded) {
      result.push(loaded);
    } else {
      // Fall back to pendingFiles (base64 data, not yet uploaded)
      const pending = pendingFiles.find(f => f.name === name);
      if (pending) {
        result.push({
          name: pending.name,
          type: pending.type,
          url: pending.dataUrl, // Use base64 dataUrl directly
          pageUrls: pending.pdfPages,
          pageCount: pending.pdfPages?.length,
        });
      }
    }
  }

  return result;
}

interface Conversation {
  id: string;
  source: "SLACK" | "WEB";
  title: string | null;
  firstMessagePreview: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
  archived?: boolean;
  attachmentsIncluded?: string[] | null;
  imagesIncluded?: AttachedFile[] | StoredFileRef[] | null; // Base64 (session) or storage refs (from DB)
  mode?: "CHATBASE" | "DIRECT";
}

interface SearchResult {
  id: string;
  title: string | null;
  source: string;
  lastMessageAt: string;
  preview: string | null;
  matchSnippet: string | null;
}

export default function ChatPage() {
  const router = useRouter();
  const params = useParams();

  // Get conversation ID from URL params (optional catch-all returns array)
  const conversationIdFromUrl = params.id ? (Array.isArray(params.id) ? params.id[0] : params.id) : null;

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(conversationIdFromUrl);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [toast, setToast] = useState<{ message: string; position: "left" | "right" | "bottom" } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareModalConversationId, setShareModalConversationId] = useState<string | null>(null);
  const [sharedWithMeChats, setSharedWithMeChats] = useState<Array<{
    id: string;
    title: string | null;
    firstMessagePreview: string | null;
    sharedAt: string;
    sharedBy: { id: string; name: string | null; email: string | null; avatarUrl: string | null };
  }>>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);
  const [isAddingPrompt, setIsAddingPrompt] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [draggedPromptId, setDraggedPromptId] = useState<string | null>(null);
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [renamingConversation, setRenamingConversation] = useState<{ id: string; title: string } | null>(null);
  const [renamingSaving, setRenamingSaving] = useState(false);
  const [gtmVariables, setGtmVariables] = useState<GtmVariable[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0); // 0 = New Chat, 1+ = results
  const [animatingTitleId, setAnimatingTitleId] = useState<string | null>(null);
  const [animatingTitleText, setAnimatingTitleText] = useState("");
  const [animatingTitleFull, setAnimatingTitleFull] = useState("");
  const [showSlackModal, setShowSlackModal] = useState(false);
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [showMaturityModal, setShowMaturityModal] = useState(false);
  const [maturityModalMode, setMaturityModalMode] = useState<"continue" | "update">("continue");
  const [showGetStartedModal, setShowGetStartedModal] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isTTSPlaying, setIsTTSPlaying] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<Map<number, string>>(new Map()); // Map of sequence -> audio URL
  const ttsNextSeqRef = useRef(0); // Next sequence number to assign
  const ttsPlaySeqRef = useRef(0); // Next sequence number to play
  const ttsPlayingRef = useRef(false); // Is audio currently playing
  const ttsSessionRef = useRef(0); // Incremented on each new TTS session, used to cancel stale requests
  const voiceConversationModeRef = useRef(false); // Track if we're in voice conversation mode
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [playbookExpanded, setPlaybookExpanded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320); // Default 320px (w-80)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [inputHeight, setInputHeight] = useState(120); // Default input container height
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]); // Prompt attachments
  const [selectedImages, setSelectedImages] = useState<File[]>([]); // Image attachments
  const [pendingFiles, setPendingFiles] = useState<AttachedFile[]>([]); // Files sent but not yet uploaded to storage
  const [processingImages, setProcessingImages] = useState(false); // Image vision processing
  const [processingStatus, setProcessingStatus] = useState<string | null>(null); // Status message during processing
  const [isDraggingImage, setIsDraggingImage] = useState(false); // Drag-drop state
  const [conversationMode, setConversationMode] = useState<"CHATBASE" | "DIRECT">("CHATBASE"); // Chat mode toggle
  const [switchingMode, setSwitchingMode] = useState(false); // Loading state for mode switch
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]); // Lightbox images
  const [lightboxIndex, setLightboxIndex] = useState(0); // Current lightbox image index
  const [lightboxOpen, setLightboxOpen] = useState(false); // Lightbox open state
  const [lightboxDownloadData, setLightboxDownloadData] = useState<{ name: string; dataUrl: string } | null>(null); // For PDF download
  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]); // Files loaded from storage for current conversation
  const [isResizingInput, setIsResizingInput] = useState(false);
  const [showVariablesDropdown, setShowVariablesDropdown] = useState(false);
  const [appProgress, setAppProgress] = useState<{
    gtmAssessment: { answered: number; total: number; hasSubmitted: boolean } | null;
    salesNarrative: { answered: number; total: number; hasGenerated: boolean } | null;
    discoveryQuestions: { hasGenerated: boolean } | null;
    firstCallChecklist: { hasGenerated: boolean } | null;
    preCallPlanning: { hasGenerated: boolean } | null;
    emailSequence: { hasGenerated: boolean } | null;
    linkedInSequence: { hasGenerated: boolean } | null;
    callReview: { hasGenerated: boolean } | null;
  }>({ gtmAssessment: null, salesNarrative: null, discoveryQuestions: null, firstCallChecklist: null, preCallPlanning: null, emailSequence: null, linkedInSequence: null, callReview: null });
  const { confirm: showConfirm, alert: showAlert, ConfirmModalElement } = useConfirmModal();
  const menuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const isInitialLoad = useRef(true);
  const isSendingRef = useRef(false); // Track if we're in the middle of sending

  // Check if selected conversation is shared with me (not owned by me)
  const sharedChatInfo = useMemo(() => {
    if (!selectedConversation) return null;
    return sharedWithMeChats.find(c => c.id === selectedConversation) || null;
  }, [selectedConversation, sharedWithMeChats]);

  const isViewingSharedChat = !!sharedChatInfo;

  // Compute merge field preview info based on current input
  const mergeFieldPreview = useMemo(() => {
    const fields = findMergeFields(inputMessage);
    if (fields.length === 0) return null;

    const variableMap = new Map(gtmVariables.map(v => [v.mergeField, v]));
    const used: { mergeField: string; name: string; value: string }[] = [];
    const missing: string[] = [];

    for (const field of fields) {
      const variable = variableMap.get(field);
      if (variable && variable.value) {
        used.push({ mergeField: field, name: variable.name, value: variable.value });
      } else if (variable) {
        missing.push(variable.name);
      } else {
        missing.push(field); // Unknown variable
      }
    }

    return { used, missing };
  }, [inputMessage, gtmVariables]);

  // Load saved prompts from API on mount
  useEffect(() => {
    async function loadPrompts() {
      try {
        const res = await fetch("/api/saved-prompts");
        const data = await res.json();
        if (data.prompts) {
          setSavedPrompts(data.prompts);
        }
      } catch (error) {
        console.error("Error loading prompts:", error);
      } finally {
        setPromptsLoading(false);
      }
    }
    loadPrompts();
  }, []);

  // Load app progress for sidebar
  useEffect(() => {
    async function loadAppProgress() {
      try {
        // Fetch GTM Assessment progress
        const gtmRes = await fetch("/api/maturity/questions");
        if (gtmRes.ok) {
          const gtmData = await gtmRes.json();
          const answered = gtmData.questions?.filter((q: { latestAnswer: unknown }) => q.latestAnswer).length || 0;
          const total = gtmData.questions?.length || 0;
          // Check if user has ever submitted an assessment
          const assessmentRes = await fetch("/api/maturity/latest");
          const hasSubmitted = assessmentRes.ok && (await assessmentRes.json()).assessment;
          setAppProgress(prev => ({
            ...prev,
            gtmAssessment: { answered, total, hasSubmitted: !!hasSubmitted }
          }));
        }

        // Fetch Sales Narrative progress
        const snRes = await fetch("/api/sales-narrative/questions");
        if (snRes.ok) {
          const snData = await snRes.json();
          const answered = snData.questions?.filter((q: { latestAnswer: unknown }) => q.latestAnswer).length || 0;
          const total = snData.questions?.length || 0;
          // Check if user has ever generated a narrative
          const latestRes = await fetch("/api/sales-narrative/latest");
          const hasGenerated = latestRes.ok && (await latestRes.json()).hasNarrative;
          setAppProgress(prev => ({
            ...prev,
            salesNarrative: { answered, total, hasGenerated: !!hasGenerated }
          }));
        }

        // Fetch Discovery Questions progress
        const dqRes = await fetch("/api/discovery-questions/latest");
        if (dqRes.ok) {
          const dqData = await dqRes.json();
          setAppProgress(prev => ({
            ...prev,
            discoveryQuestions: { hasGenerated: !!dqData.hasDiscoveryQuestions }
          }));
        }

        // Fetch First Call Checklist progress
        const fccRes = await fetch("/api/first-call-checklist/latest");
        if (fccRes.ok) {
          const fccData = await fccRes.json();
          setAppProgress(prev => ({
            ...prev,
            firstCallChecklist: { hasGenerated: !!fccData.hasFirstCallChecklist }
          }));
        }

        // Fetch Pre-Call Planning progress
        const pcpRes = await fetch("/api/pre-call-planning/latest");
        if (pcpRes.ok) {
          const pcpData = await pcpRes.json();
          setAppProgress(prev => ({
            ...prev,
            preCallPlanning: { hasGenerated: !!pcpData.hasPreCallPlanning }
          }));
        }

        // Fetch Email Sequence progress
        const esRes = await fetch("/api/email-sequence/latest");
        if (esRes.ok) {
          const esData = await esRes.json();
          setAppProgress(prev => ({
            ...prev,
            emailSequence: { hasGenerated: !!esData.hasEmailSequence }
          }));
        }

        // Fetch LinkedIn Sequence progress
        const lsRes = await fetch("/api/linkedin-sequence/latest");
        if (lsRes.ok) {
          const lsData = await lsRes.json();
          setAppProgress(prev => ({
            ...prev,
            linkedInSequence: { hasGenerated: !!lsData.hasLinkedInSequence }
          }));
        }

        // Fetch Call Review progress
        const crRes = await fetch("/api/call-review/latest");
        if (crRes.ok) {
          const crData = await crRes.json();
          setAppProgress(prev => ({
            ...prev,
            callReview: { hasGenerated: !!crData.hasCallReview }
          }));
        }
      } catch (error) {
        console.error("Error loading app progress:", error);
      }
    }
    loadAppProgress();
  }, []);

  // Auto-select Sales Narrative as default attachment when user has one
  // Runs when narrative availability changes or conversation changes
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    // Reset auto-select flag when conversation changes
    hasAutoSelectedRef.current = false;
  }, [selectedConversation]);

  useEffect(() => {
    // Only auto-select once per conversation, and only if:
    // 1. User has a generated narrative
    // 2. We haven't already auto-selected for this conversation
    // 3. Current conversation doesn't already have attachments sent
    if (
      appProgress.salesNarrative?.hasGenerated &&
      !hasAutoSelectedRef.current
    ) {
      const currentConversation = conversations.find(c => c.id === selectedConversation);
      if (!currentConversation?.attachmentsIncluded?.length) {
        hasAutoSelectedRef.current = true;
        setSelectedAttachments(["salesNarrative"]);
      }
    }
  }, [appProgress.salesNarrative?.hasGenerated, selectedConversation, conversations]);

  // Spacebar to interrupt TTS and start listening
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if spacebar, TTS is playing, and not typing in an input
      if (
        e.code === "Space" &&
        isTTSPlaying &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName || "")
      ) {
        e.preventDefault();
        // Stop TTS inline to avoid stale closure
        ttsSessionRef.current += 1;
        ttsQueueRef.current.forEach((url) => {
          if (url) URL.revokeObjectURL(url);
        });
        ttsQueueRef.current.clear();
        ttsNextSeqRef.current = 0;
        ttsPlaySeqRef.current = 0;
        if (ttsAudioRef.current) {
          ttsAudioRef.current.pause();
          ttsAudioRef.current = null;
        }
        ttsPlayingRef.current = false;
        setIsTTSPlaying(false);
        // Start listening
        voiceConversationModeRef.current = true;
        setIsVoiceRecording(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTTSPlaying]);

  // Reset a single prompt to its default (only for default prompts)
  const handleResetPromptToDefault = async (promptId: string) => {
    try {
      const res = await fetch(`/api/saved-prompts/${promptId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const data = await res.json();
      if (data.prompt) {
        setSavedPrompts((prev) =>
          prev.map((p) => (p.id === promptId ? data.prompt : p))
        );
        setEditingPrompt(data.prompt);
      }
    } catch (error) {
      console.error("Error resetting prompt:", error);
    }
  };

  // Check if a prompt can be reset (is a default prompt that's been modified)
  const canResetPrompt = (prompt: SavedPrompt): boolean => {
    if (!prompt.defaultPromptId) return false;
    const defaultPrompt = DEFAULT_PROMPTS.find((p) => p.id === prompt.defaultPromptId);
    if (!defaultPrompt) return false;
    return (
      prompt.title !== defaultPrompt.title ||
      prompt.prompt !== defaultPrompt.prompt ||
      prompt.emoji !== defaultPrompt.emoji
    );
  };

  // Save edited prompt
  const handleSavePrompt = async (prompt: SavedPrompt) => {
    setSavingPrompt(true);
    try {
      if (isAddingPrompt) {
        // Adding new prompt via API
        const res = await fetch("/api/saved-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emoji: prompt.emoji,
            title: prompt.title,
            prompt: prompt.prompt,
          }),
        });
        const data = await res.json();
        if (data.prompt) {
          setSavedPrompts((prev) => [...prev, data.prompt]);
        }
      } else {
        // Editing existing prompt via API
        const res = await fetch(`/api/saved-prompts/${prompt.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emoji: prompt.emoji,
            title: prompt.title,
            prompt: prompt.prompt,
          }),
        });
        const data = await res.json();
        if (data.prompt) {
          setSavedPrompts((prev) =>
            prev.map((p) => (p.id === prompt.id ? data.prompt : p))
          );
        }
      }
    } catch (error) {
      console.error("Error saving prompt:", error);
    } finally {
      setSavingPrompt(false);
    }
    setEditingPrompt(null);
    setIsAddingPrompt(false);
  };

  // Clone a prompt
  const handleClonePrompt = async (prompt: SavedPrompt) => {
    try {
      const res = await fetch("/api/saved-prompts/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: prompt.id }),
      });
      const data = await res.json();
      if (data.prompt) {
        setSavedPrompts((prev) => [...prev, data.prompt]);
      }
    } catch (error) {
      console.error("Error cloning prompt:", error);
    }
  };

  // Delete a prompt
  const handleDeletePrompt = async (promptId: string) => {
    try {
      await fetch(`/api/saved-prompts/${promptId}`, {
        method: "DELETE",
      });
      setSavedPrompts((prev) => prev.filter((p) => p.id !== promptId));
    } catch (error) {
      console.error("Error deleting prompt:", error);
    }
  };

  // Add new prompt
  const handleAddPrompt = () => {
    setEditingPrompt({
      id: "", // Will be assigned by server
      emoji: "💡",
      title: "",
      prompt: "",
      defaultPromptId: null,
    });
    setIsAddingPrompt(true);
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, promptId: string) => {
    setDraggedPromptId(promptId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetPromptId: string) => {
    e.preventDefault();
    if (!draggedPromptId || draggedPromptId === targetPromptId) return;

    // Calculate new order
    const newPrompts = [...savedPrompts];
    const draggedIndex = newPrompts.findIndex((p) => p.id === draggedPromptId);
    const targetIndex = newPrompts.findIndex((p) => p.id === targetPromptId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const [draggedPrompt] = newPrompts.splice(draggedIndex, 1);
    newPrompts.splice(targetIndex, 0, draggedPrompt);

    // Optimistically update UI
    setSavedPrompts(newPrompts);
    setDraggedPromptId(null);

    // Sync with API
    try {
      await fetch("/api/saved-prompts/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptIds: newPrompts.map(p => p.id) }),
      });
    } catch (error) {
      console.error("Error reordering prompts:", error);
    }
  }, [draggedPromptId, savedPrompts]);

  const handleDragEnd = useCallback(() => {
    setDraggedPromptId(null);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sidebar resize handler
  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar]);

  // Input area resize handler
  useEffect(() => {
    if (!isResizingInput) return;

    const handleMouseMove = (e: MouseEvent) => {
      const windowHeight = window.innerHeight;
      const newHeight = Math.max(80, Math.min(400, windowHeight - e.clientY));
      setInputHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingInput(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingInput]);

  // Cmd+K keyboard shortcut for search
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchOpen(true);
        setSearchSelectedIndex(0); // Reset to "New Chat"
      }
      // Escape to close search
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
        setSearchQuery("");
        setSearchSelectedIndex(0);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen]);

  // Focus search input when overlay opens
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      setSearchSelectedIndex(0); // Reset selection when opening
    }
  }, [searchOpen]);

  // Search API call with debounce
  useEffect(() => {
    if (!searchOpen) return;

    const searchConversations = async () => {
      setSearchLoading(true);
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) {
          params.set("q", searchQuery.trim());
        }
        params.set("limit", "10");
        const res = await fetch(`/api/conversations/search?${params}`);
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setSearchLoading(false);
      }
    };

    // Debounce search
    const timeoutId = setTimeout(searchConversations, 200);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchOpen]);

  // Handle search result selection
  const handleSearchSelect = (conversationId: string) => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchSelectedIndex(0);
    selectConversation(conversationId);
  };

  // Handle new chat from search overlay
  const handleSearchNewChat = async () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchSelectedIndex(0);
    await handleNewChat();
    // Focus the chat input after creating new chat
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 100);
  };

  // Handle keyboard navigation in search
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = searchResults.length + 1; // +1 for "New Chat"

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchSelectedIndex === 0) {
        handleSearchNewChat();
      } else {
        const selectedResult = searchResults[searchSelectedIndex - 1];
        if (selectedResult) {
          handleSearchSelect(selectedResult.id);
        }
      }
    }
  };

  // Highlight search term in text
  const highlightSearchTerm = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <strong key={i} className="font-semibold">{part}</strong> : part
    );
  };

  // Typewriter animation for new titles
  useEffect(() => {
    if (!animatingTitleId || !animatingTitleFull) return;

    let currentIndex = 0;
    const typeSpeed = 30; // ms per character

    const interval = setInterval(() => {
      currentIndex++;
      setAnimatingTitleText(animatingTitleFull.substring(0, currentIndex));

      if (currentIndex >= animatingTitleFull.length) {
        clearInterval(interval);
        // Clear animation state after a short delay
        setTimeout(() => {
          setAnimatingTitleId(null);
          setAnimatingTitleText("");
          setAnimatingTitleFull("");
        }, 500);
      }
    }, typeSpeed);

    return () => clearInterval(interval);
  }, [animatingTitleId, animatingTitleFull]);

  // Start title animation
  const startTitleAnimation = (conversationId: string, title: string) => {
    setAnimatingTitleId(conversationId);
    setAnimatingTitleText("");
    setAnimatingTitleFull(title);
  };

  // Show toast notification
  const showToast = (message: string, position: "left" | "right" | "bottom" = "right") => {
    setToast({ message, position });
    setTimeout(() => setToast(null), 3000);
  };

  // Copy conversation as rich text (preserves formatting when pasted)
  const handleCopy = async () => {
    if (messages.length === 0) return;

    const success = await copyMessagesAsRichText(
      messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }))
    );

    if (success) {
      showToast("Copied to clipboard!");
    } else {
      showToast("Failed to copy");
    }
  };

  // Share conversation (header button)
  const handleShare = async () => {
    if (!selectedConversation || messages.length === 0 || sharing) return;

    setSharing(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        navigator.clipboard.writeText(data.shareUrl);
        showToast("Link copied! This chat is now available to anyone with this link.");
      } else {
        showToast("Failed to share conversation");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation");
    } finally {
      setSharing(false);
    }
  };

  // Share conversation (inline button under messages)
  const handleInlineShare = async () => {
    if (!selectedConversation || messages.length === 0 || sharing) return;

    setSharing(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        navigator.clipboard.writeText(data.shareUrl);
        showToast("Link copied! This chat is now available to anyone with this link.", "bottom");
      } else {
        showToast("Failed to share conversation", "bottom");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation", "bottom");
    } finally {
      setSharing(false);
    }
  };

  // Share specific message (with anchor to scroll to that response)
  const handleShareMessage = async (messageId: string) => {
    if (!selectedConversation || messages.length === 0 || sharing) return;

    setSharing(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        // Append anchor to scroll to specific message
        const urlWithAnchor = `${data.shareUrl}#msg-${messageId}`;
        navigator.clipboard.writeText(urlWithAnchor);
        showToast("Link copied! Opens directly to this response.", "bottom");
      } else {
        showToast("Failed to share conversation", "bottom");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation", "bottom");
    } finally {
      setSharing(false);
    }
  };

  // Email conversation
  const handleEmailConversation = async (toEmail?: string) => {
    if (!selectedConversation || messages.length === 0 || emailSending) return;

    const targetEmail = toEmail || emailAddress;
    if (!targetEmail) {
      setShowEmailModal(true);
      return;
    }

    setEmailSending(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Conversation sent to ${targetEmail}!`, "bottom");
        setShowEmailModal(false);
        setEmailAddress("");
      } else {
        showToast(data.error || "Failed to send email", "bottom");
      }
    } catch (error) {
      console.error("Error emailing:", error);
      showToast("Failed to send email", "bottom");
    } finally {
      setEmailSending(false);
    }
  };

  // Share a specific conversation from the sidebar menu
  const handleShareConversation = async (conversationId: string) => {
    setSharingId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.shareUrl) {
        navigator.clipboard.writeText(data.shareUrl);
        showToast("Link copied! This chat is now available to anyone with this link.", "left");
      } else {
        showToast("Failed to share conversation", "left");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      showToast("Failed to share conversation", "left");
    } finally {
      setSharingId(null);
      setOpenMenuId(null);
    }
  };

  // Open rename modal
  const handleRenameConversation = (conversationId: string, currentTitle: string | null) => {
    setOpenMenuId(null);
    setRenamingConversation({
      id: conversationId,
      title: currentTitle || "",
    });
  };

  // Save renamed conversation
  const handleSaveRename = async () => {
    if (!renamingConversation) return;

    setRenamingSaving(true);
    try {
      const res = await fetch(`/api/conversations/${renamingConversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: renamingConversation.title }),
      });

      if (res.ok) {
        // Update in list
        setConversations((prev) =>
          prev.map((c) => (c.id === renamingConversation.id ? { ...c, title: renamingConversation.title } : c))
        );
        showToast("Conversation renamed", "left");
        setRenamingConversation(null);
      } else {
        showToast("Failed to rename conversation", "left");
      }
    } catch (error) {
      console.error("Error renaming:", error);
      showToast("Failed to rename conversation", "left");
    } finally {
      setRenamingSaving(false);
    }
  };

  // Archive a conversation
  const handleArchiveConversation = async (conversationId: string) => {
    setOpenMenuId(null);
    setArchivingId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (res.ok) {
        // Remove from list
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        // If this was selected, clear selection
        if (selectedConversation === conversationId) {
          selectConversation(null);
        }
        showToast("Conversation archived", "left");
      } else {
        showToast("Failed to archive conversation", "left");
      }
    } catch (error) {
      console.error("Error archiving:", error);
      showToast("Failed to archive conversation", "left");
    } finally {
      setArchivingId(null);
    }
  };

  // Delete a conversation
  const handleDeleteConversation = async (conversationId: string) => {
    setOpenMenuId(null);
    const confirmed = await showConfirm({
      title: "Delete Conversation",
      message: "Are you sure you want to delete this conversation? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        // Remove from list
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        // If this was selected, clear selection
        if (selectedConversation === conversationId) {
          selectConversation(null);
        }
        showToast("Conversation deleted", "left");
      } else {
        showToast("Failed to delete conversation", "left");
      }
    } catch (error) {
      console.error("Error deleting:", error);
      showToast("Failed to delete conversation", "left");
    }
  };

  // Update URL when conversation changes (without full page reload)
  const selectConversation = (conversationId: string | null) => {
    // Reset sending state when switching conversations
    // This allows loading the new conversation even if previous was mid-send
    isSendingRef.current = false;
    setSending(false);

    setSelectedConversation(conversationId);
    isInitialLoad.current = true; // Reset for new conversation
    // Set mode from conversation list data, or default to CHATBASE for new chats
    const conv = conversations.find(c => c.id === conversationId);
    setConversationMode(conv?.mode || "CHATBASE");
    // Use pushState to update URL without triggering Next.js navigation
    const newUrl = conversationId ? `/chat/${conversationId}` : '/chat';
    window.history.pushState({}, '', newUrl);
  };

  // Update browser tab title based on selected conversation
  useEffect(() => {
    if (selectedConversation) {
      const conv = conversations.find((c) => c.id === selectedConversation);
      const title = conv?.title || conv?.firstMessagePreview?.slice(0, 50) || "Chat";
      document.title = `${title} - Mikey`;
    } else {
      document.title = "Mikey - New Chat";
    }
  }, [selectedConversation, conversations]);

  // Auto-scroll disabled - user prefers manual scrolling
  useEffect(() => {
    if (messages.length > 0 && isInitialLoad.current) {
      isInitialLoad.current = false;
    }
  }, [messages]);

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    const savedSidebarState = localStorage.getItem("mikey_sidebar_collapsed");
    if (savedSidebarState === "true") {
      setSidebarCollapsed(true);
    }
  }, []);

  // Switch between Mikey (Chatbase) and Direct (OpenAI GPT) mode
  const setConversationModeTo = useCallback(async (newMode: "CHATBASE" | "DIRECT") => {
    if (switchingMode || sending || conversationMode === newMode) return;

    // If no conversation exists yet, just update local state
    if (!selectedConversation) {
      setConversationMode(newMode);
      return;
    }

    setSwitchingMode(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        setConversationMode(newMode);
        // Update the conversation in the list too
        setConversations(prev =>
          prev.map(c => c.id === selectedConversation ? { ...c, mode: newMode } : c)
        );
        setToast({
          message: newMode === "DIRECT"
            ? "Switched to Direct LLM — full context, no RAG"
            : "Switched to Founding Sales Content — RAG active",
          position: "bottom",
        });
      }
    } catch (error) {
      console.error("Error switching mode:", error);
    } finally {
      setSwitchingMode(false);
    }
  }, [conversationMode, selectedConversation, switchingMode, sending, setToast, setConversations]);

  // Save sidebar state to localStorage when it changes
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const newValue = !prev;
      localStorage.setItem("mikey_sidebar_collapsed", String(newValue));
      return newValue;
    });
  }, []);

  // Load user and conversations on mount
  useEffect(() => {
    async function loadData() {
      try {
        // Get current user
        const userRes = await fetch("/api/auth/me");
        const userData = await userRes.json();

        if (!userData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        setUser(userData.user);

        // Show Slack modal for Google-only users who haven't dismissed it
        if (userData.user.isGoogleUser && !userData.user.isSlackUser) {
          const dismissed = localStorage.getItem("slackModalDismissed");
          if (!dismissed) {
            setShowSlackModal(true);
          }
        }

        // Show Google modal for Slack-only users who haven't dismissed it
        if (userData.user.isSlackUser && !userData.user.isGoogleUser) {
          const dismissed = localStorage.getItem("googleModalDismissed");
          if (!dismissed) {
            setShowGoogleModal(true);
          }
        }

        // Show profile completion modal if name or email is missing
        if (userData.user.missingName || userData.user.missingEmail) {
          const skipped = localStorage.getItem("profileCompletionSkipped");
          if (!skipped) {
            setShowProfileModal(true);
          }
        }

        // Get conversations
        const convsRes = await fetch("/api/conversations");
        const convsData = await convsRes.json();
        setConversations(convsData.conversations || []);

        // Get chats shared with me
        try {
          const sharedRes = await fetch("/api/chat/shared");
          const sharedData = await sharedRes.json();
          setSharedWithMeChats(sharedData.sharedChats || []);
        } catch {
          console.error("Failed to load shared chats");
        }

        // Load GTM variables for merge field expansion
        const varsRes = await fetch("/api/gtm-variables");
        const varsData = await varsRes.json();
        if (varsData.variables) {
          setGtmVariables(varsData.variables.map((v: { mergeField: string; name: string; value: string | null }) => ({
            mergeField: v.mergeField,
            name: v.name,
            value: v.value,
          })));
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  // Handle startAssessment query param (from homepage CTA)
  useEffect(() => {
    if (loading || !user) return;

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("startAssessment") === "true") {
      setShowMaturityModal(true);
      // Remove the query param from URL without reload
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, [loading, user]);

  // Show "Get Started" modal for users who haven't created a sales narrative yet
  useEffect(() => {
    if (loading || !user) return;
    if (appProgress.salesNarrative === null) return;
    if (appProgress.salesNarrative.hasGenerated) return;
    if (showMaturityModal || showProfileModal) return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("startAssessment") === "true") return;
    const dismissed = sessionStorage.getItem("getStartedModalDismissed");
    if (dismissed) return;
    setShowGetStartedModal(true);
  }, [loading, user, appProgress.salesNarrative, showMaturityModal, showProfileModal]);

  // Load messages when conversation is selected
  useEffect(() => {
    async function loadMessages() {
      if (!selectedConversation) {
        setMessages([]);
        setLoadedFiles([]); // Clear loaded files when no conversation
        setPendingFiles([]); // Clear pending files too
        return;
      }

      // Skip loading if we're in the middle of sending (prevents race condition)
      if (isSendingRef.current) {
        return;
      }

      setLoadingMessages(true);
      try {
        const res = await fetch(`/api/conversations/${selectedConversation}`);
        const data = await res.json();
        setMessages(data.conversation?.messages || []);
        // Sync mode from server
        if (data.conversation?.mode) {
          setConversationMode(data.conversation.mode);
        }

        // Load attached files if conversation has imagesIncluded
        if (data.conversation?.imagesIncluded && data.conversation.imagesIncluded.length > 0) {
          try {
            const filesRes = await fetch(`/api/conversations/${selectedConversation}/attachments`);
            const filesData = await filesRes.json();
            if (filesData.files) {
              setLoadedFiles(filesData.files);
              setPendingFiles([]); // Clear pending since we have real files now
            }
          } catch (filesError) {
            console.error("Error loading attached files:", filesError);
            setLoadedFiles([]);
          }
        } else {
          setLoadedFiles([]);
          setPendingFiles([]); // Clear pending when no files in conversation
        }
      } catch (error) {
        console.error("Error loading messages:", error);
      } finally {
        setLoadingMessages(false);
      }
    }

    loadMessages();
  }, [selectedConversation]);

  const handleNewChat = async () => {
    if (creatingChat) return;
    setCreatingChat(true);
    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      const data = await res.json();

      if (data.conversation) {
        setConversations([data.conversation, ...conversations]);
        selectConversation(data.conversation.id);
        setMessages([]);
        // Focus the chat input after creating new chat
        setTimeout(() => {
          chatInputRef.current?.focus();
        }, 100);
      }
    } catch (error) {
      console.error("Error creating conversation:", error);
    } finally {
      setCreatingChat(false);
    }
  };

  // Handle drag-and-drop for images
  // Handle drag-and-drop for files (images and PDFs)
  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingImage(false);

    const files = Array.from(e.dataTransfer.files);
    const supportedFiles = files.filter(isSupportedFile);

    if (supportedFiles.length > 0) {
      const maxFiles = 4;
      const remaining = maxFiles - selectedImages.length;
      const filesToAdd = supportedFiles.slice(0, remaining);
      if (filesToAdd.length > 0) {
        setSelectedImages([...selectedImages, ...filesToAdd]);
      }
    }
  };

  const handleImageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if any of the dragged items are images, PDFs, or CSVs
    const hasSupportedFiles = Array.from(e.dataTransfer.items).some(
      (item) => item.kind === "file" && (item.type.startsWith("image/") || item.type === "application/pdf" || item.type === "text/csv" || (item.type === "" && item.kind === "file"))
    );
    if (hasSupportedFiles) {
      setIsDraggingImage(true);
    }
  };

  const handleImageDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the container (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingImage(false);
    }
  };

  // Handle paste event for images from clipboard
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));

    if (imageItems.length > 0) {
      e.preventDefault(); // Prevent pasting image as text

      const maxFiles = 4;
      const remaining = maxFiles - selectedImages.length;

      const filesToAdd: File[] = [];
      for (const item of imageItems.slice(0, remaining)) {
        const file = item.getAsFile();
        if (file) {
          // Create a new file with a meaningful name
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const extension = file.type.split("/")[1] || "png";
          const namedFile = new File([file], `pasted-image-${timestamp}.${extension}`, {
            type: file.type,
          });
          filesToAdd.push(namedFile);
        }
      }

      if (filesToAdd.length > 0) {
        setSelectedImages([...selectedImages, ...filesToAdd]);
      }
    }
  };

  // Process a single image through vision API
  const processImageThroughVision = async (base64: string, fileName: string): Promise<string> => {
    try {
      const res = await fetch("/api/vision/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64,
          extractionType: "sales",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return data.description || "(No content extracted)";
      } else {
        console.error("Failed to process image:", fileName);
        return "(Failed to process)";
      }
    } catch (error) {
      console.error("Error processing image:", fileName, error);
      return "(Error processing)";
    }
  };

  // Process files (images, PDFs, and CSVs) through vision API / parsing and return descriptions
  const processFiles = async (files: File[]): Promise<string[]> => {
    const descriptions: string[] = [];

    for (const file of files) {
      try {
        if (isCSVFile(file)) {
          // Parse CSV and convert to readable text
          const csvText = await file.text();
          const parsed = Papa.parse<Record<string, string>>(csvText, {
            header: true,
            skipEmptyLines: true,
          });

          if (parsed.errors.length > 0 && parsed.data.length === 0) {
            descriptions.push(`[CSV: ${file.name}] (Error: could not parse CSV)`);
            continue;
          }

          // Convert rows to readable text: "Column: Value" format separated by dividers
          const textContent = parsed.data
            .map((row) =>
              Object.entries(row)
                .filter(([, val]) => val && val.trim())
                .map(([key, val]) => `${key}: ${val}`)
                .join("\n"),
            )
            .filter((block) => block.trim())
            .join("\n---\n");

          // Truncate if very large
          const truncated = textContent.length > 30000
            ? textContent.substring(0, 30000) + "\n\n(CSV content truncated due to size)"
            : textContent;

          descriptions.push(`[CSV: ${file.name}] (${parsed.data.length} rows)\n${truncated}`);
        } else if (isPDFFile(file)) {
          // Convert PDF to images and process each page
          console.log(`[PDF] Converting ${file.name} to images...`);
          const pdfResult = await convertPDFToImages(file, { maxPages: 50 });

          // Process all pages in parallel for speed
          console.log(`[PDF] Processing ${pdfResult.pages.length} pages in parallel...`);
          const pageResults = await Promise.all(
            pdfResult.pages.map(async (page) => {
              const pageDesc = await processImageThroughVision(page.dataUrl, `${file.name} (page ${page.pageNumber})`);
              return { pageNumber: page.pageNumber, description: pageDesc };
            })
          );

          // Sort by page number and format
          const pageDescriptions = pageResults
            .sort((a, b) => a.pageNumber - b.pageNumber)
            .map((r) => `--- Page ${r.pageNumber} ---\n${r.description}`);

          const truncatedNote = pdfResult.totalPages > pdfResult.pages.length
            ? `\n\n(Showing ${pdfResult.pages.length} of ${pdfResult.totalPages} pages)`
            : "";

          descriptions.push(`[PDF: ${file.name}]\n${pageDescriptions.join("\n\n")}${truncatedNote}`);
        } else {
          // Process regular image
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const imageDesc = await processImageThroughVision(base64, file.name);
          descriptions.push(`[Image: ${file.name}]\n${imageDesc}`);
        }
      } catch (error) {
        console.error("Error processing file:", file.name, error);
        const fileType = isCSVFile(file) ? "CSV" : isPDFFile(file) ? "PDF" : "Image";
        descriptions.push(`[${fileType}: ${file.name}] (Error processing)`);
      }
    }

    return descriptions;
  };

  // Legacy alias
  const processImages = processFiles;

  // Open lightbox for pre-send images (File objects)
  const openLightboxForFiles = async (files: File[], startIndex: number) => {
    const images: LightboxImage[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (isPDFFile(file)) {
        // Convert PDF to images for lightbox preview
        try {
          const pdfResult = await convertPDFToImages(file, { maxPages: 50 });
          pdfResult.pages.forEach((page) => {
            images.push({
              url: page.dataUrl,
              name: file.name,
              type: "pdf-page",
              pageNumber: page.pageNumber,
            });
          });
        } catch (error) {
          console.error("Failed to convert PDF for preview:", error);
        }
      } else {
        // Create blob URL for image preview
        const url = URL.createObjectURL(file);
        images.push({
          url,
          name: file.name,
          type: "image",
        });
      }
    }

    if (images.length > 0) {
      // Adjust start index if clicking on a PDF (count pages of earlier files)
      let adjustedIndex = 0;
      for (let i = 0; i < startIndex && i < files.length; i++) {
        if (isPDFFile(files[i])) {
          // Count pages from earlier PDFs - for simplicity, just advance by 1 for now
          // The actual conversion happened above, so we check the images array
          const pdfPages = images.filter(img => img.name === files[i].name).length;
          adjustedIndex += pdfPages || 1;
        } else {
          adjustedIndex += 1;
        }
      }

      setLightboxImages(images);
      setLightboxIndex(Math.min(adjustedIndex, images.length - 1));
      setLightboxDownloadData(null);
      setLightboxOpen(true);
    }
  };

  // Open lightbox for post-send images (AttachedFile objects)
  const openLightboxForAttachedFiles = (files: AttachedFile[], startIndex: number) => {
    const images: LightboxImage[] = [];
    let downloadData: { name: string; dataUrl: string } | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type === "pdf" && file.pdfPages) {
        // Add all PDF pages
        file.pdfPages.forEach((pageUrl, pageIndex) => {
          images.push({
            url: pageUrl,
            name: file.name,
            type: "pdf-page",
            pageNumber: pageIndex + 1,
          });
        });
        // Store PDF data for download if this is the clicked file
        if (i === startIndex) {
          downloadData = { name: file.name, dataUrl: file.dataUrl };
        }
      } else {
        images.push({
          url: file.dataUrl,
          name: file.name,
          type: "image",
        });
      }
    }

    if (images.length > 0) {
      // Calculate adjusted index
      let adjustedIndex = 0;
      for (let i = 0; i < startIndex && i < files.length; i++) {
        if (files[i].type === "pdf" && files[i].pdfPages) {
          adjustedIndex += files[i].pdfPages!.length;
        } else {
          adjustedIndex += 1;
        }
      }

      setLightboxImages(images);
      setLightboxIndex(Math.min(adjustedIndex, images.length - 1));
      setLightboxDownloadData(downloadData);
      setLightboxOpen(true);
    }
  };

  // Open lightbox for files loaded from storage (LoadedFile objects with URLs)
  const openLightboxForLoadedFiles = (files: LoadedFile[], startIndex: number) => {
    const images: LightboxImage[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type === "pdf" && file.pageUrls) {
        // Add all PDF pages
        file.pageUrls.forEach((pageUrl, pageIndex) => {
          images.push({
            url: pageUrl,
            name: file.name,
            type: "pdf-page",
            pageNumber: pageIndex + 1,
          });
        });
      } else if (file.url) {
        images.push({
          url: file.url,
          name: file.name,
          type: "image",
        });
      }
    }

    if (images.length > 0) {
      // Calculate adjusted index
      let adjustedIndex = 0;
      for (let i = 0; i < startIndex && i < files.length; i++) {
        if (files[i].type === "pdf" && files[i].pageUrls) {
          adjustedIndex += files[i].pageUrls!.length;
        } else {
          adjustedIndex += 1;
        }
      }

      setLightboxImages(images);
      setLightboxIndex(Math.min(adjustedIndex, images.length - 1));
      setLightboxDownloadData(null); // No download for URL-based files (they can right-click save)
      setLightboxOpen(true);
    }
  };

  // Handle lightbox download (for PDFs)
  const handleLightboxDownload = () => {
    if (lightboxDownloadData) {
      // Create download link
      const link = document.createElement("a");
      link.href = lightboxDownloadData.dataUrl;
      link.download = lightboxDownloadData.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Close lightbox and cleanup
  const closeLightbox = () => {
    setLightboxOpen(false);
    // Cleanup blob URLs from pre-send images
    lightboxImages.forEach((img) => {
      if (img.type === "image" && img.url.startsWith("blob:")) {
        URL.revokeObjectURL(img.url);
      }
    });
    setLightboxImages([]);
    setLightboxIndex(0);
    setLightboxDownloadData(null);
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || sending || !user?.canChat) return;

    // Mark that we're sending to prevent loadMessages race condition
    isSendingRef.current = true;

    // If no conversation selected, create one first
    let conversationId = selectedConversation;
    let isNewConversation = false;
    if (!conversationId) {
      isNewConversation = true;
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: conversationMode }),
        });
        const data = await res.json();
        if (data.conversation) {
          conversationId = data.conversation.id;
          setConversations([{ ...data.conversation, mode: conversationMode }, ...conversations]);
          selectConversation(conversationId);
          // Re-set since selectConversation resets sending state
          isSendingRef.current = true;
        }
      } catch (error) {
        console.error("Error creating conversation:", error);
        isSendingRef.current = false;
        return;
      }
    }

    // Check if this is the first message (for title polling)
    const isFirstMessage = isNewConversation || messages.length === 0;

    // Check if attachments can be added (only once per conversation)
    const currentConversation = conversations.find(c => c.id === conversationId);
    const canAddAttachments = !currentConversation?.attachmentsIncluded?.length;

    // Capture attachments before clearing
    const attachmentsToSend = canAddAttachments ? [...selectedAttachments] : [];
    const imagesToProcess = [...selectedImages];

    const userMessage = messageText.trim();
    setInputMessage("");
    setSelectedAttachments([]); // Clear attachments after sending
    // Don't clear images yet - keep them visible during processing
    setSending(true);

    // Process images through vision API and collect file data for storage
    let finalMessage = userMessage;
    let attachedFiles: AttachedFile[] = [];

    if (imagesToProcess.length > 0) {
      setProcessingImages(true);
      const fileCount = imagesToProcess.length;
      const hasNonImage = imagesToProcess.some(f => f.type === "application/pdf" || isCSVFile(f));
      const fileType = hasNonImage ? "files" : "images";
      setProcessingStatus(`Analyzing ${fileCount} ${fileType}...`);
      try {
        // Convert files to base64 data URLs for storage before processing
        attachedFiles = await Promise.all(
          imagesToProcess.map(async (file): Promise<AttachedFile> => {
            if (isCSVFile(file)) {
              // CSV files: store the parsed text, no base64 image needed
              const csvText = await file.text();
              return {
                name: file.name,
                type: "csv",
                dataUrl: "", // No visual preview for CSVs
                csvText,
              };
            } else if (isPDFFile(file)) {
              // Convert PDF pages to images
              const pdfResult = await convertPDFToImages(file, { maxPages: 50 });
              return {
                name: file.name,
                type: "pdf",
                dataUrl: pdfResult.pages[0]?.dataUrl || "",
                pdfPages: pdfResult.pages.map((p) => p.dataUrl),
              };
            } else {
              // Convert image to base64
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              return {
                name: file.name,
                type: "image",
                dataUrl,
              };
            }
          })
        );

        // Now process through vision API
        const imageDescriptions = await processFiles(imagesToProcess);
        if (imageDescriptions.length > 0) {
          // Append image descriptions after user message
          finalMessage = `${userMessage}\n\n---\n\n${imageDescriptions.join("\n\n")}`;
        }
      } finally {
        setProcessingImages(false);
        setProcessingStatus(null);
        setSelectedImages([]); // Clear images after processing is done
        // Immediately show the processed files while upload happens in background
        setPendingFiles(prev => [...prev, ...attachedFiles]);
      }
    }

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: finalMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Start title polling IMMEDIATELY if this is the first message
    // Don't wait for the API response - poll in parallel
    if (isFirstMessage && conversationId) {
      const pollForTitle = async () => {
        const maxAttempts = 20; // More attempts since we start immediately
        const pollInterval = 500; // 500ms between polls

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));

          try {
            const titleRes = await fetch(`/api/conversations/${conversationId}/title`);
            const titleData = await titleRes.json();

            if (titleData.title) {
              // Got a title! Update the conversation and animate
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === conversationId ? { ...c, title: titleData.title } : c
                )
              );
              startTitleAnimation(conversationId, titleData.title);
              break;
            }
          } catch (err) {
            console.error("Error polling for title:", err);
          }
        }
      };

      // Start polling immediately (runs in background)
      pollForTitle();
    }

    try {
      // Use streaming endpoint
      const res = await fetch(`/api/conversations/${conversationId}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: finalMessage,
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to send message",
          variant: "danger",
        });
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        return;
      }

      // Process the SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let fullResponse = "";
      let messageId = "";
      let createdAt = "";

      setStreamingMessage(""); // Reset streaming message

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            // Track event type for next data line
            continue;
          }
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);

              if (parsed.text) {
                // Text chunk from streaming
                fullResponse += parsed.text;
                setStreamingMessage(fullResponse);
              } else if (parsed.messageId) {
                // Done event with message metadata
                messageId = parsed.messageId;
                createdAt = parsed.createdAt;
                // Update user message if backend saved expanded version (with attachments)
                if (parsed.savedUserMessage) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === tempUserMsg.id ? { ...m, content: parsed.savedUserMessage } : m
                    )
                  );
                }
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch {
              // Non-JSON data, ignore
            }
          }
        }
      }

      // Clear streaming message and add the complete message
      setStreamingMessage("");

      if (fullResponse) {
        const assistantMessage: Message = {
          id: messageId || `msg-${Date.now()}`,
          role: "ASSISTANT",
          content: fullResponse,
          createdAt: createdAt || new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }

      // Upload files to storage if we have any
      if (attachedFiles.length > 0 && conversationId) {
        try {
          const uploadRes = await fetch(`/api/conversations/${conversationId}/attachments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: attachedFiles.map((f) => ({
                name: f.name,
                type: f.type,
                dataUrl: f.dataUrl,
                pdfPages: f.pdfPages,
              })),
            }),
          });

          if (uploadRes.ok) {
            // Reload files from storage to get signed URLs for display
            const filesRes = await fetch(`/api/conversations/${conversationId}/attachments`);
            if (filesRes.ok) {
              const filesData = await filesRes.json();
              if (filesData.files) {
                setLoadedFiles(filesData.files);
                setPendingFiles([]); // Clear pending files now that we have signed URLs
              }
            }
          } else {
            console.error("Failed to upload attachments:", await uploadRes.text());
          }
        } catch (uploadError) {
          console.error("Error uploading attachments:", uploadError);
        }
      }

      // Update conversation in list and move to top (most recent)
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                firstMessagePreview: c.firstMessagePreview || userMessage.substring(0, 100),
                messageCount: c.messageCount + 2,
                lastMessageAt: new Date().toISOString(),
                // Mark attachments as included if we sent them
                ...(attachmentsToSend.length > 0 && { attachmentsIncluded: attachmentsToSend }),
                // Mark images as included if we processed them
                ...(attachedFiles.length > 0 && { imagesIncluded: attachedFiles }),
              }
            : c
        );
        // Sort by lastMessageAt descending
        return updated.sort((a, b) =>
          new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
        );
      });
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setStreamingMessage("");
    } finally {
      setSending(false);
      isSendingRef.current = false;
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputMessage);
  };

  // Generate TTS for a chunk and add to queue in order
  const generateTTSChunk = async (text: string, sessionId: number, seqNum: number): Promise<void> => {
    if (!text.trim()) return;

    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      // Check if this session is still active (user may have clicked Stop)
      if (sessionId !== ttsSessionRef.current) {
        return; // Stale request, discard
      }

      if (!res.ok) {
        console.error("Failed to generate speech chunk");
        // Mark this sequence as failed so playback can skip it
        ttsQueueRef.current.set(seqNum, "");
        playNextInQueue();
        return;
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Double-check session is still active
      if (sessionId !== ttsSessionRef.current) {
        URL.revokeObjectURL(audioUrl);
        return;
      }

      // Add to queue at correct position
      ttsQueueRef.current.set(seqNum, audioUrl);

      // Start playing if not already
      if (!ttsPlayingRef.current) {
        playNextInQueue();
      }
    } catch (err) {
      console.error("Error generating TTS chunk:", err);
      // Mark as failed
      ttsQueueRef.current.set(seqNum, "");
      playNextInQueue();
    }
  };

  // Play the next audio chunk in sequence order
  const playNextInQueue = (onAllFinished?: () => void) => {
    const nextSeq = ttsPlaySeqRef.current;
    const audioUrl = ttsQueueRef.current.get(nextSeq);

    // If next chunk isn't ready yet, wait (it will call playNextInQueue when ready)
    if (audioUrl === undefined) {
      // Check if we have any pending chunks at all
      if (ttsQueueRef.current.size === 0 && ttsPlayingRef.current) {
        ttsPlayingRef.current = false;
        setIsTTSPlaying(false);
        // All TTS finished - auto-resume listening if in voice conversation mode
        if (voiceConversationModeRef.current) {
          setIsVoiceRecording(true);
        }
      }
      return;
    }

    // Remove from queue
    ttsQueueRef.current.delete(nextSeq);
    ttsPlaySeqRef.current = nextSeq + 1;

    // Skip failed/empty chunks
    if (!audioUrl) {
      playNextInQueue(onAllFinished);
      return;
    }

    ttsPlayingRef.current = true;
    setIsTTSPlaying(true);

    const audio = new Audio(audioUrl);
    ttsAudioRef.current = audio;

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      ttsAudioRef.current = null;
      playNextInQueue(onAllFinished); // Play next chunk
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      ttsAudioRef.current = null;
      playNextInQueue(onAllFinished); // Skip to next chunk on error
    };

    audio.play().catch(() => {
      playNextInQueue(onAllFinished);
    });
  };

  // Stop TTS playback and clear queue
  const stopTTS = () => {
    // Increment session to invalidate any in-flight TTS requests
    ttsSessionRef.current += 1;

    // Clear the queue
    ttsQueueRef.current.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    ttsQueueRef.current.clear();
    ttsNextSeqRef.current = 0;
    ttsPlaySeqRef.current = 0;

    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }

    ttsPlayingRef.current = false;
    setIsTTSPlaying(false);
  };

  // Voice message - sends message, streams response with chunked TTS
  const sendVoiceMessageWithTTS = async (messageText: string): Promise<void> => {
    if (!messageText.trim() || !user?.canChat) return;

    // If no conversation selected, create one first
    let conversationId = selectedConversation;
    if (!conversationId) {
      try {
        const res = await fetch("/api/conversations", { method: "POST" });
        const data = await res.json();
        if (data.conversation) {
          conversationId = data.conversation.id;
          setConversations((prev) => [data.conversation, ...prev]);
          setSelectedConversation(conversationId);
          router.push(`/chat/${conversationId}`, { scroll: false });
        }
      } catch (error) {
        console.error("Error creating conversation:", error);
        return;
      }
    }

    const userMessage = messageText.trim();

    // Add user message to UI
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Show sending state with streaming
    setSending(true);
    setStreamingMessage("");

    // Start a new TTS session (invalidates any previous in-flight requests)
    ttsSessionRef.current += 1;
    const currentSession = ttsSessionRef.current;

    // Clear any previous TTS queue (but keep isTTSPlaying true to maintain UI)
    ttsQueueRef.current.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    ttsQueueRef.current.clear();
    ttsNextSeqRef.current = 0;
    ttsPlaySeqRef.current = 0;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    ttsPlayingRef.current = false;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("Error:", data.error);
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let fullResponse = "";
      let messageId = "";
      let createdAt = "";
      let ttsBuffer = ""; // Buffer for TTS sentence detection

      // Helper to flush TTS buffer when we have a complete sentence
      const flushTTSSentence = () => {
        if (ttsBuffer.trim()) {
          const seq = ttsNextSeqRef.current++;
          generateTTSChunk(ttsBuffer.trim(), currentSession, seq);
          ttsBuffer = "";
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                fullResponse += parsed.text;
                ttsBuffer += parsed.text;
                setStreamingMessage(fullResponse);

                // Check for TTS chunk boundaries - more aggressive for faster start
                // Priority 1: Sentence boundaries (. ! ?) followed by space
                const sentenceMatch = ttsBuffer.match(/^([\s\S]*?[.!?])\s+/);
                if (sentenceMatch) {
                  const sentence = sentenceMatch[1];
                  const seq = ttsNextSeqRef.current++;
                  generateTTSChunk(sentence, currentSession, seq);
                  ttsBuffer = ttsBuffer.slice(sentenceMatch[0].length);
                } else if (ttsBuffer.includes("\n\n")) {
                  // Priority 2: Paragraph break - flush what we have
                  const parts = ttsBuffer.split("\n\n");
                  for (let i = 0; i < parts.length - 1; i++) {
                    if (parts[i].trim()) {
                      const seq = ttsNextSeqRef.current++;
                      generateTTSChunk(parts[i].trim(), currentSession, seq);
                    }
                  }
                  ttsBuffer = parts[parts.length - 1];
                } else if (ttsBuffer.length >= 60) {
                  // Priority 3: Clause boundaries when buffer is long enough
                  // Match comma, semicolon, or colon followed by space
                  const clauseMatch = ttsBuffer.match(/^([\s\S]{30,}?[,;:])\s+/);
                  if (clauseMatch) {
                    const clause = clauseMatch[1];
                    const seq = ttsNextSeqRef.current++;
                    generateTTSChunk(clause, currentSession, seq);
                    ttsBuffer = ttsBuffer.slice(clauseMatch[0].length);
                  } else if (ttsBuffer.length >= 100) {
                    // Priority 4: Force flush at word boundary if buffer is very long
                    const wordBreak = ttsBuffer.match(/^([\s\S]{60,}?\s)\S/);
                    if (wordBreak) {
                      const chunk = wordBreak[1].trim();
                      const seq = ttsNextSeqRef.current++;
                      generateTTSChunk(chunk, currentSession, seq);
                      ttsBuffer = ttsBuffer.slice(wordBreak[1].length);
                    }
                  }
                }
              } else if (parsed.messageId) {
                messageId = parsed.messageId;
                createdAt = parsed.createdAt;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Flush any remaining TTS buffer
      flushTTSSentence();

      // Clear streaming and add complete message
      setStreamingMessage("");
      setSending(false);

      if (fullResponse) {
        const assistantMessage: Message = {
          id: messageId || `msg-${Date.now()}`,
          role: "ASSISTANT",
          content: fullResponse,
          createdAt: createdAt || new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Update conversation list
        setConversations((prev) => {
          const updated = prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  firstMessagePreview: c.firstMessagePreview || userMessage.substring(0, 100),
                  messageCount: c.messageCount + 2,
                  lastMessageAt: new Date().toISOString(),
                }
              : c
          );
          return updated.sort((a, b) =>
            new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
          );
        });
      }

      // TTS will continue playing from the queue - no need to wait
    } catch (error) {
      console.error("Error sending voice message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setSending(false);
      setStreamingMessage("");
    }
  };

  const insertVariable = (mergeField: string) => {
    const textarea = chatInputRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = inputMessage;
    const insertText = `{{${mergeField}}}`;

    const newText = text.substring(0, start) + insertText + text.substring(end);
    setInputMessage(newText);
    setShowVariablesDropdown(false);

    // Set cursor position after the inserted text
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
    }, 0);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-2 text-gray-500">
          <div className="flex gap-1">
            <span className="animate-bounce" style={{ animationDelay: "0ms" }}>🌊</span>
            <span className="animate-bounce" style={{ animationDelay: "150ms" }}>🌊</span>
            <span className="animate-bounce" style={{ animationDelay: "300ms" }}>🌊</span>
          </div>
          <span>Mikey is thinking...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <SalesNavBar />
      <div className={`flex-1 flex bg-white overflow-hidden`}>
      {/* Sidebar - fixed height, doesn't scroll with chat */}
      <div
        className={`bg-gray-100 border-r border-gray-200 flex flex-col h-full flex-shrink-0 overflow-hidden relative ${!isResizingSidebar ? "transition-all duration-300" : ""}`}
        style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
      >
        {/* Resize handle */}
        {!sidebarCollapsed && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/50 transition-colors group z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingSidebar(true);
            }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <button
            onClick={handleNewChat}
            disabled={creatingChat}
            className="flex-shrink-0 hover:opacity-80 transition-opacity disabled:opacity-50"
            title="Start new chat"
          >
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-[80px] h-[80px] rounded-lg"
            />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900">Mikey</h1>
            <p className="text-sm text-gray-500 truncate">{user?.workspaceName}</p>
          </div>
          {/* Collapse sidebar button */}
          <button
            onClick={toggleSidebar}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            title="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-4 space-y-2">
          <button
            onClick={handleNewChat}
            disabled={creatingChat}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {creatingChat ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </>
            ) : (
              "+ New Chat"
            )}
          </button>
          {/* Search Button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full py-2 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            Search
            <span className="text-xs text-gray-400 ml-auto">⌘K</span>
          </button>
        </div>

        {/* Tools Section - Operational / Frequent */}
        <div className="px-4 pb-2">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Tools</div>
          <div className="space-y-1">
            <a
              href="/pre-call-planning/research"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <span className="w-5 h-5 rounded-full border-2 border-blue-400 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              </span>
              <span>🔬</span>
              <span className="flex-1">Pre-Call Research</span>
            </a>
            <a
              href="/call-review"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {appProgress.callReview?.hasGenerated ? (
                <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
              ) : (
                <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
              )}
              <span>📞</span>
              <span className="flex-1">Call Review</span>
            </a>
            <a
              href="/email-sequence"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {appProgress.emailSequence?.hasGenerated ? (
                <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
              ) : (
                <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
              )}
              <span>📧</span>
              <span className="flex-1">Email Sequence</span>
            </a>
            <a
              href="/linkedin-sequence"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {appProgress.linkedInSequence?.hasGenerated ? (
                <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
              ) : (
                <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
              )}
              <span>💼</span>
              <span className="flex-1">LinkedIn Sequence</span>
            </a>
            <a
              href="/files"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <span className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center">
                <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </span>
              <span>📁</span>
              <span className="flex-1">Images & Files</span>
            </a>
          </div>
        </div>

        {/* Playbook Section - Foundational / Infrequent (collapsible) */}
        <div className="px-4 pb-3">
          <button
            onClick={() => setPlaybookExpanded(!playbookExpanded)}
            className="flex items-center justify-between w-full mb-2"
          >
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              📒 Playbook
              {(() => {
                const completed = [
                  appProgress.gtmAssessment?.hasSubmitted,
                  appProgress.salesNarrative?.hasGenerated,
                  appProgress.discoveryQuestions?.hasGenerated,
                  appProgress.firstCallChecklist?.hasGenerated,
                  appProgress.preCallPlanning?.hasGenerated,
                ].filter(Boolean).length;
                return completed > 0 ? (
                  <span className="text-green-600 font-medium">{completed}/5</span>
                ) : null;
              })()}
            </div>
            <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${playbookExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {playbookExpanded && (
            <div className="space-y-1">
              <a
                href="/assessment/bulk"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {appProgress.gtmAssessment?.hasSubmitted ? (
                  <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
                ) : appProgress.gtmAssessment && appProgress.gtmAssessment.answered > 0 ? (
                  <span className="w-5 h-5 rounded-full border-2 border-orange-400 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-orange-400"></span>
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
                )}
                <span>📊</span>
                <span className="flex-1">GTM Assessment</span>
                {appProgress.gtmAssessment && !appProgress.gtmAssessment.hasSubmitted && appProgress.gtmAssessment.answered > 0 && (
                  <span className="text-xs text-orange-600 font-medium">
                    {appProgress.gtmAssessment.answered}/{appProgress.gtmAssessment.total}
                  </span>
                )}
                {!appProgress.gtmAssessment?.hasSubmitted && (!appProgress.gtmAssessment || appProgress.gtmAssessment.answered === 0) && (
                  <span className="text-xs text-purple-600 font-medium">Start →</span>
                )}
              </a>
              <a
                href="/sales-narrative"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {appProgress.salesNarrative?.hasGenerated ? (
                  <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
                ) : appProgress.salesNarrative && appProgress.salesNarrative.answered > 0 ? (
                  <span className="w-5 h-5 rounded-full border-2 border-orange-400 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-orange-400"></span>
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
                )}
                <span>📝</span>
                <span className="flex-1">Sales Narrative</span>
                {appProgress.salesNarrative && !appProgress.salesNarrative.hasGenerated && appProgress.salesNarrative.answered > 0 && (
                  <span className="text-xs text-orange-600 font-medium">
                    {appProgress.salesNarrative.answered}/{appProgress.salesNarrative.total}
                  </span>
                )}
                {!appProgress.salesNarrative?.hasGenerated && (!appProgress.salesNarrative || appProgress.salesNarrative.answered === 0) && (
                  <span className="text-xs text-purple-600 font-medium">Start →</span>
                )}
              </a>
              <a
                href="/discovery-questions"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {appProgress.discoveryQuestions?.hasGenerated ? (
                  <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
                )}
                <span>🔍</span>
                <span className="flex-1">Discovery Questions</span>
                {!appProgress.discoveryQuestions?.hasGenerated && (
                  <span className="text-xs text-purple-600 font-medium">Start →</span>
                )}
              </a>
              <a
                href="/first-call-checklist"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {appProgress.firstCallChecklist?.hasGenerated ? (
                  <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
                )}
                <span>📋</span>
                <span className="flex-1">First Call Checklist</span>
                {!appProgress.firstCallChecklist?.hasGenerated && (
                  <span className="text-xs text-purple-600 font-medium">Start →</span>
                )}
              </a>
              <a
                href="/pre-call-planning"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {appProgress.preCallPlanning?.hasGenerated ? (
                  <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
                ) : (
                  <span className="w-5 h-5 rounded-full border-2 border-gray-300"></span>
                )}
                <span>🎯</span>
                <span className="flex-1">Pre-Call Checklist</span>
                {!appProgress.preCallPlanning?.hasGenerated && (
                  <span className="text-xs text-purple-600 font-medium">Start →</span>
                )}
              </a>
            </div>
          )}
        </div>

        {/* Conversations List - this part scrolls independently */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No conversations yet. Start a new chat!
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`relative group border-b border-gray-200 ${
                  archivingId === conv.id ? "opacity-50" : ""
                } ${
                  selectedConversation === conv.id ? "bg-white" : "hover:bg-gray-200"
                } ${openMenuId === conv.id ? "z-50" : ""}`}
              >
                <a
                  href={`/chat/${conv.id}`}
                  onClick={(e) => {
                    // Allow cmd+click, ctrl+click, shift+click, middle-click to work naturally
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
                      return;
                    }
                    // Normal click: use SPA navigation
                    e.preventDefault();
                    if (archivingId !== conv.id) {
                      selectConversation(conv.id);
                    }
                  }}
                  className={`block w-full p-4 text-left transition-colors ${archivingId === conv.id ? "pointer-events-none" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {archivingId === conv.id ? (
                      <>
                        <svg className="animate-spin h-3 w-3 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-[13px] text-gray-400">Archiving...</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[13px] text-gray-400">
                          {conv.source === "SLACK" ? "💬 Slack" : "🌐 Web"}
                        </span>
                        <span className="text-[13px] text-gray-400">
                          {formatRelativeTime(conv.lastMessageAt)}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-[15px] text-gray-900 truncate pr-8 flex items-center gap-1.5">
                    {conv.mode === "DIRECT" && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500 flex-shrink-0">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                      </svg>
                    )}
                    {animatingTitleId === conv.id ? (
                      <span>
                        {animatingTitleText}
                        <span className="animate-pulse">|</span>
                      </span>
                    ) : (
                      conv.title || conv.firstMessagePreview || "New conversation"
                    )}
                  </p>
                </a>

                {/* Three-dot menu button */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                    }}
                    className={`p-1.5 rounded hover:bg-gray-300 transition-colors ${
                      openMenuId === conv.id ? "bg-gray-300" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-gray-600">
                      <circle cx="12" cy="5" r="2"></circle>
                      <circle cx="12" cy="12" r="2"></circle>
                      <circle cx="12" cy="19" r="2"></circle>
                    </svg>
                  </button>

                  {/* Dropdown menu */}
                  {openMenuId === conv.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameConversation(conv.id, conv.title);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShareConversation(conv.id);
                        }}
                        disabled={sharingId === conv.id}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 disabled:opacity-50"
                      >
                        {sharingId === conv.id ? (
                          <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="18" cy="5" r="3"></circle>
                            <circle cx="6" cy="12" r="3"></circle>
                            <circle cx="18" cy="19" r="3"></circle>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                          </svg>
                        )}
                        {sharingId === conv.id ? "Sharing..." : "Share Link"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShareModalConversationId(conv.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                          <circle cx="8.5" cy="7" r="4"></circle>
                          <line x1="20" y1="8" x2="20" y2="14"></line>
                          <line x1="23" y1="11" x2="17" y2="11"></line>
                        </svg>
                        Share with Colleague...
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          try {
                            const res = await fetch(`/api/chat/${conv.id}/clone`, { method: "POST" });
                            const data = await res.json();
                            if (data.success && data.conversationId) {
                              showToast("Chat cloned! Redirecting...", "bottom");
                              window.location.href = `/chat/${data.conversationId}`;
                            }
                          } catch {
                            showToast("Failed to clone chat", "bottom");
                          }
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        Clone
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchiveConversation(conv.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="21 8 21 21 3 21 3 8"></polyline>
                          <rect x="1" y="3" width="22" height="5"></rect>
                          <line x1="10" y1="12" x2="14" y2="12"></line>
                        </svg>
                        Archive
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteConversation(conv.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Shared with me section */}
          {sharedWithMeChats.length > 0 && (
            <div className="mt-4 border-t border-gray-300 pt-2">
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Shared with me
              </div>
              {sharedWithMeChats.map((chat) => (
                <a
                  key={`shared-${chat.id}`}
                  href={`/chat/${chat.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                    e.preventDefault();
                    selectConversation(chat.id);
                  }}
                  className={`block p-4 border-b border-gray-200 transition-colors ${
                    selectedConversation === chat.id ? "bg-white" : "hover:bg-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] text-blue-600">
                      From {chat.sharedBy.name || chat.sharedBy.email?.split("@")[0] || "someone"}
                    </span>
                  </div>
                  <p className="text-[15px] text-gray-900 truncate">
                    {chat.title || chat.firstMessagePreview || "Untitled Chat"}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* User Info - stays at bottom */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">
              {user?.name || user?.email || "User"}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Sign Out
            </button>
          </div>
          <div className="text-xs text-gray-500">
            {user?.licenseStatus === "ACTIVE" ? (
              <div className="flex items-center justify-between">
                <span className="text-green-600">✓ Licensed</span>
                <button
                  onClick={async () => {
                    const res = await fetch("/api/stripe/portal", { method: "POST" });
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  }}
                  className="text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Manage
                </button>
              </div>
            ) : user?.licenseStatus === "TRIAL" ? (
              <span className="text-blue-600">
                🎁 Trial ({user.trialDaysRemaining} days left)
              </span>
            ) : (
              <span className="text-red-600">Trial ended</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Area - scrolls independently */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top header with Upgrade and Copy/Share buttons */}
        <div className="border-b border-gray-200 px-6 py-3 flex justify-between items-center bg-white">
          <div className="flex items-center gap-3">
            {/* Expand sidebar button (shown when collapsed) */}
            {sidebarCollapsed && (
              <button
                onClick={toggleSidebar}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Open sidebar"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            {/* GTM Maturity Assessment Widget */}
            <MaturityAssessmentWidget onStartAssessment={(mode) => {
                              setMaturityModalMode(mode || "continue");
                              setShowMaturityModal(true);
                            }} />

            {/* Add to Slack button for Google-only users */}
            {user && user.isGoogleUser && !user.isSlackUser && (
              <a
                href="/api/slack/oauth"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#4A154B] text-white font-medium rounded-lg hover:bg-[#3a1139] transition-colors text-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                </svg>
                Add Mikey to your Slack!
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Settings button */}
            <a
              href="/settings"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              Settings
            </a>
            {/* Upgrade button - show for non-active users */}
            {user && user.licenseStatus !== "ACTIVE" && (
              <a
                href="/upgrade"
                className="px-4 py-1.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-semibold rounded-lg hover:from-pink-600 hover:to-purple-600 transition-all shadow-sm"
              >
                Upgrade
              </a>
            )}
            {/* Copy/Share buttons - only show when messages exist and not viewing shared chat */}
            {messages.length > 0 && !isViewingSharedChat && (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  Copy
                </button>
                <button
                  onClick={handleShare}
                  disabled={sharing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {sharing ? (
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                  )}
                  {sharing ? "Copying..." : "Link"}
                </button>
                <button
                  onClick={() => setShareModalConversationId(selectedConversation)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="8.5" cy="7" r="4"></circle>
                    <line x1="20" y1="8" x2="20" y2="14"></line>
                    <line x1="23" y1="11" x2="17" y2="11"></line>
                  </svg>
                  Share
                </button>
              </>
            )}
            {/* Shared chat badge and clone button */}
            {isViewingSharedChat && sharedChatInfo && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="8.5" cy="7" r="4"></circle>
                    <line x1="20" y1="8" x2="20" y2="14"></line>
                    <line x1="23" y1="11" x2="17" y2="11"></line>
                  </svg>
                  Shared by {sharedChatInfo.sharedBy.name || sharedChatInfo.sharedBy.email?.split("@")[0] || "someone"}
                </div>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/chat/${selectedConversation}/clone`, { method: "POST" });
                      const data = await res.json();
                      if (data.conversationId) {
                        router.push(`/chat/${data.conversationId}`);
                        showToast("Chat cloned! You can now continue this conversation.", "bottom");
                      }
                    } catch {
                      showToast("Failed to clone chat", "bottom");
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  Clone to Continue
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {loadingMessages ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-500">
                <div className="flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>🌊</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>🌊</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>🌊</span>
                </div>
                <span>Mikey is thinking...</span>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full overflow-y-auto flex flex-col">
              <div className="flex-1 flex flex-col justify-center max-w-[950px] mx-auto w-full px-4 py-8">
                <div className="text-center">
                  <img
                    src="/mikey-avatar.png"
                    alt="Mikey"
                    className="w-32 h-32 rounded-3xl mx-auto mb-4"
                  />
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">
                    {user?.name ? `Hey, ${user.name.split(' ')[0]}!` : 'Welcome to Mikey'}
                  </h2>
                  <p className="text-gray-500 mb-6">
                    What can I help you with today?
                  </p>
                </div>

                {/* Floating Input for New Chat */}
                {user?.canChat && (
                  <form onSubmit={handleSendMessage} className="max-w-[700px] mx-auto w-full mb-8">
                    {/* Merge field preview/warning */}
                    {mergeFieldPreview && (
                      <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                        {mergeFieldPreview.missing.length > 0 && (
                          <div className="flex items-start gap-2 text-orange-600 mb-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                              <line x1="12" y1="9" x2="12" y2="13"></line>
                              <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                            <span>
                              Missing variables: <strong>{mergeFieldPreview.missing.join(", ")}</strong>
                              {" "}<a href="/settings" className="text-blue-600 hover:underline">Configure in Settings</a>
                            </span>
                          </div>
                        )}
                        {mergeFieldPreview.used.length > 0 && (
                          <div className="space-y-2">
                            {mergeFieldPreview.used.map((v) => (
                              <div key={v.mergeField} className="text-gray-600">
                                <span className="font-medium text-blue-600">{`{{${v.mergeField}}}`}</span>
                                <span className="text-gray-400 mx-2">→</span>
                                <span className="text-gray-700">{v.value.length > 100 ? v.value.substring(0, 100) + "..." : v.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {(isVoiceRecording || isTTSPlaying) ? (
                      <VoiceRecordingInput
                        isActive={isVoiceRecording}
                        isSpeaking={isTTSPlaying}
                        onCancel={() => {
                          voiceConversationModeRef.current = false;
                          setIsVoiceRecording(false);
                          stopTTS();
                        }}
                        onTranscriptionComplete={(text) => {
                          setIsVoiceRecording(false);
                          setIsTTSPlaying(true); // Keep voice UI visible while TTS loads
                          sendVoiceMessageWithTTS(text);
                        }}
                        onStopSpeaking={stopTTS}
                      />
                    ) : (
                      <div
                        className={`relative border rounded-2xl bg-white shadow-sm transition-colors ${isDraggingImage ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}
                        onDrop={handleImageDrop}
                        onDragOver={handleImageDragOver}
                        onDragLeave={handleImageDragLeave}
                      >
                        {/* Drag overlay */}
                        {isDraggingImage && (
                          <div className="absolute inset-0 flex items-center justify-center bg-blue-50/80 rounded-2xl z-10 pointer-events-none">
                            <div className="text-blue-600 font-medium flex items-center gap-2">
                              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              Drop file here
                            </div>
                          </div>
                        )}
                        {/* Attachment chips and image previews inside card at top - only for pending uploads */}
                        {(conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded?.length ||
                          selectedAttachments.length > 0 || selectedImages.length > 0) && (
                          <div className="px-4 pt-3 rounded-t-2xl space-y-2">
                            {conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded?.length ? (
                              <AttachmentChipsReadOnly
                                attachments={conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded as string[]}
                              />
                            ) : selectedAttachments.length > 0 ? (
                              <AttachmentChips
                                attachments={selectedAttachments}
                                onRemove={(id) => setSelectedAttachments(selectedAttachments.filter(a => a !== id))}
                              />
                            ) : null}
                            {selectedImages.length > 0 ? (
                              <ImagePreviewChips
                                files={selectedImages}
                                onRemove={(index) => setSelectedImages(selectedImages.filter((_, i) => i !== index))}
                                onPreview={(index) => openLightboxForFiles(selectedImages, index)}
                                processing={processingImages}
                              />
                            ) : null}
                          </div>
                        )}
                        {/* Processing status */}
                        {processingStatus && (
                          <div className="px-4 py-2 text-sm text-blue-600 flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            {processingStatus}
                          </div>
                        )}

                        {/* Full-width textarea */}
                        <textarea
                          ref={chatInputRef}
                          value={inputMessage}
                          onChange={(e) => setInputMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                              e.preventDefault();
                              if (inputMessage.trim() && !sending) {
                                handleSendMessage(e);
                              }
                            }
                          }}
                          onPaste={handlePaste}
                          placeholder="Ask Mikey anything about founder-led sales..."
                          className="w-full px-4 py-3 border-0 focus:outline-none focus:ring-0 resize-none min-h-[60px] max-h-[200px] text-[16px] rounded-t-2xl"
                          rows={2}
                          style={{ height: 'auto' }}
                          onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                          }}
                        />

                        {/* Bottom toolbar */}
                        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 rounded-b-2xl">
                          {/* Left side - action buttons */}
                          <div className="flex items-center gap-1">
                            {/* GTM Variables Dropdown */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setShowVariablesDropdown(!showVariablesDropdown)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Insert GTM Variable"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                              </button>
                              {showVariablesDropdown && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setShowVariablesDropdown(false)}
                                  />
                                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-80 overflow-y-auto">
                                    <div className="p-2 border-b border-gray-100">
                                      <span className="text-xs font-medium text-gray-500 uppercase">Insert Variable</span>
                                    </div>
                                    {gtmVariables.length === 0 ? (
                                      <div className="p-3 text-sm text-gray-500">
                                        No variables configured.{" "}
                                        <a href="/settings" className="text-blue-600 hover:underline">
                                          Add in Settings
                                        </a>
                                      </div>
                                    ) : (
                                      <div className="py-1">
                                        {gtmVariables.map((v) => (
                                          <button
                                            key={v.mergeField}
                                            type="button"
                                            onClick={() => insertVariable(v.mergeField)}
                                            className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center justify-between gap-2"
                                          >
                                            <div className="min-w-0">
                                              <div className="text-sm font-medium text-gray-900 truncate">{v.name}</div>
                                              <div className="text-xs text-blue-600 font-mono">{`{{${v.mergeField}}}`}</div>
                                            </div>
                                            {v.value ? (
                                              <span className="flex-shrink-0 w-2 h-2 bg-green-500 rounded-full" title="Has value" />
                                            ) : (
                                              <span className="flex-shrink-0 w-2 h-2 bg-orange-400 rounded-full" title="No value set" />
                                            )}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <div className="p-2 border-t border-gray-100">
                                      <a
                                        href="/settings"
                                        className="text-xs text-gray-500 hover:text-blue-600"
                                      >
                                        Manage variables →
                                      </a>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                            {/* Attachment Picker */}
                            {!conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded?.length && (
                              <AttachmentPicker
                                selectedAttachments={selectedAttachments}
                                onSelectionChange={setSelectedAttachments}
                                disabled={sending}
                                isFirstMessage={true}
                              />
                            )}
                            {/* Image Attachment Button */}
                            <ImageAttachmentButton
                              onFilesChange={(newFiles: File[]) => setSelectedImages([...selectedImages, ...newFiles])}
                              disabled={sending || processingImages}
                              currentCount={selectedImages.length}
                              maxFiles={4}
                            />
                          </div>

                          {/* Right side - send buttons */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                voiceConversationModeRef.current = true;
                                setIsVoiceRecording(true);
                              }}
                              className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Voice input"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                              </svg>
                            </button>
                            <button
                              type="submit"
                              disabled={!inputMessage.trim() || sending || processingImages}
                              className="p-2 text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                              title="Send message"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </form>
                )}

                {/* Apps Section - encourage users to fill out first */}
                <div className="max-w-[950px] mx-auto w-full mb-8">
                  <p className="text-sm text-gray-500 mb-3">Complete your GTM profile for personalized advice:</p>
                  <div className="grid grid-cols-4 gap-3">
                    <a
                      href={appProgress.gtmAssessment?.hasSubmitted ? "/maturity-history" : "/assessment/bulk"}
                      className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-purple-300 hover:shadow-md transition-all text-center group"
                    >
                      <div className="relative">
                        <span className="text-3xl">📊</span>
                        {appProgress.gtmAssessment?.hasSubmitted && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                        )}
                      </div>
                      <span className="text-sm font-medium text-gray-700">GTM Assessment</span>
                      {appProgress.gtmAssessment?.hasSubmitted ? (
                        <span className="text-xs text-green-600">Completed</span>
                      ) : appProgress.gtmAssessment && appProgress.gtmAssessment.answered > 0 ? (
                        <span className="text-xs text-orange-600">{appProgress.gtmAssessment.answered}/{appProgress.gtmAssessment.total} answered</span>
                      ) : (
                        <span className="text-xs text-purple-600 group-hover:underline">Start →</span>
                      )}
                    </a>
                    <a
                      href={appProgress.salesNarrative?.hasGenerated ? "/sales-narrative/history" : "/sales-narrative"}
                      className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-purple-300 hover:shadow-md transition-all text-center group"
                    >
                      <div className="relative">
                        <span className="text-3xl">📝</span>
                        {appProgress.salesNarrative?.hasGenerated && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                        )}
                      </div>
                      <span className="text-sm font-medium text-gray-700">Sales Narrative</span>
                      {appProgress.salesNarrative?.hasGenerated ? (
                        <span className="text-xs text-green-600">Completed</span>
                      ) : appProgress.salesNarrative && appProgress.salesNarrative.answered > 0 ? (
                        <span className="text-xs text-orange-600">{appProgress.salesNarrative.answered}/{appProgress.salesNarrative.total} answered</span>
                      ) : (
                        <span className="text-xs text-purple-600 group-hover:underline">Start →</span>
                      )}
                    </a>
                    <a
                      href={appProgress.discoveryQuestions?.hasGenerated ? "/discovery-questions/history" : "/discovery-questions"}
                      className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-purple-300 hover:shadow-md transition-all text-center group"
                    >
                      <div className="relative">
                        <span className="text-3xl">🔍</span>
                        {appProgress.discoveryQuestions?.hasGenerated && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                        )}
                      </div>
                      <span className="text-sm font-medium text-gray-700">Discovery Questions</span>
                      {appProgress.discoveryQuestions?.hasGenerated ? (
                        <span className="text-xs text-green-600">Completed</span>
                      ) : (
                        <span className="text-xs text-purple-600 group-hover:underline">Start →</span>
                      )}
                    </a>
                    <a
                      href={appProgress.firstCallChecklist?.hasGenerated ? "/first-call-checklist/history" : "/first-call-checklist"}
                      className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-purple-300 hover:shadow-md transition-all text-center group"
                    >
                      <div className="relative">
                        <span className="text-3xl">📋</span>
                        {appProgress.firstCallChecklist?.hasGenerated && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                        )}
                      </div>
                      <span className="text-sm font-medium text-gray-700">First Call Checklist</span>
                      {appProgress.firstCallChecklist?.hasGenerated ? (
                        <span className="text-xs text-green-600">Completed</span>
                      ) : (
                        <span className="text-xs text-purple-600 group-hover:underline">Start →</span>
                      )}
                    </a>
                    <a
                      href={appProgress.preCallPlanning?.hasGenerated ? "/pre-call-planning/history" : "/pre-call-planning"}
                      className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-purple-300 hover:shadow-md transition-all text-center group"
                    >
                      <div className="relative">
                        <span className="text-3xl">🎯</span>
                        {appProgress.preCallPlanning?.hasGenerated && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                        )}
                      </div>
                      <span className="text-sm font-medium text-gray-700">Pre-Call Checklist</span>
                      {appProgress.preCallPlanning?.hasGenerated ? (
                        <span className="text-xs text-green-600">Completed</span>
                      ) : (
                        <span className="text-xs text-purple-600 group-hover:underline">Start →</span>
                      )}
                    </a>
                    <a
                      href="/pre-call-planning/research"
                      className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all text-center group"
                    >
                      <div className="relative">
                        <span className="text-3xl">🔍</span>
                      </div>
                      <span className="text-sm font-medium text-gray-700">Pre-Call Research</span>
                      <span className="text-xs text-blue-600 group-hover:underline">Research →</span>
                    </a>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-4 max-w-[950px] mx-auto w-full">
                  <p className="text-sm text-gray-500">
                    Or try one of these:
                  </p>
                  <button
                    onClick={handleAddPrompt}
                    className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    + Add Prompt
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 max-w-[950px] mx-auto w-full">
                  {savedPrompts.map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, item.id)}
                      onDragEnd={handleDragEnd}
                      className={`group relative flex items-start gap-3 text-left px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-grab active:cursor-grabbing min-h-[72px] w-[300px] ${
                        draggedPromptId === item.id ? "opacity-50" : ""
                      }`}
                    >
                      <button
                        onClick={() => sendMessage(item.prompt)}
                        className="flex items-start gap-3 text-left flex-1 min-w-0"
                      >
                        <span className="text-2xl flex-shrink-0 mt-0.5">{item.emoji}</span>
                        <span className="text-gray-700 text-sm line-clamp-2">{item.title}</span>
                      </button>
                      {/* Edit/Clone buttons - appear on hover */}
                      <div className="absolute right-1 bottom-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPrompt(item);
                            setIsAddingPrompt(false);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                          title="Edit"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClonePrompt(item);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                          title="Clone"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3 text-center">
                  Drag prompts to reorder. Hover to edit or clone.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-[800px] mx-auto space-y-6">
              {messages.map((msg, msgIndex) => (
                <div key={msg.id}>
                  {msg.role === "USER" ? (
                    <div className="flex justify-end">
                      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 max-w-[70%]">
                        {/* Show attached images/PDFs for this specific message */}
                        {(() => {
                          const messageFiles = getMessageFiles(msg.content, loadedFiles, pendingFiles);
                          if (messageFiles.length === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-2 mb-3">
                              {messageFiles.map((file, fileIndex) => (
                                <div
                                  key={`${file.name}-${fileIndex}`}
                                  className="cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => openLightboxForLoadedFiles(messageFiles, fileIndex)}
                                >
                                  {file.type === "pdf" || file.type === "csv" ? (
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                        <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6Z" fill={file.type === "csv" ? "#2E7D32" : "#E53935"}/>
                                        <path d="M14 2V8H20L14 2Z" fill={file.type === "csv" ? "#C8E6C9" : "#FFCDD2"}/>
                                        <text x="12" y="17" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="Arial, sans-serif">{file.type === "csv" ? "CSV" : "PDF"}</text>
                                      </svg>
                                      <span className="max-w-[120px] truncate">{file.name}</span>
                                    </div>
                                  ) : (
                                    <img
                                      src={file.url || ""}
                                      alt={file.name}
                                      className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        <TruncatedUserMessage
                          content={expandMergeFieldsInText(msg.content, gtmVariables)}
                          maxLines={20}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="prose max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-hr:my-4 mt-4 text-[17px]">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      {/* Copy/Share buttons for this response */}
                      <div className="flex items-center gap-1 mt-2">
                        <div className="relative group">
                          <button
                            onClick={async () => {
                              const success = await copyMarkdownAsRichText(msg.content);
                              showToast(success ? "Copied to clipboard!" : "Failed to copy", "bottom");
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                            Copy
                          </span>
                        </div>
                        <div className="relative group">
                          <button
                            onClick={() => handleShareMessage(msg.id)}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            title="Share link to this response"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                          </button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                            Share this response
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                streamingMessage ? (
                  // Show streaming response as it comes in
                  <div className="flex gap-3 mt-4">
                    <img
                      src="/mikey-avatar.png"
                      alt="Mikey"
                      className="w-8 h-8 rounded-lg flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="prose prose-sm max-w-none text-gray-700">
                        <ReactMarkdown>{streamingMessage}</ReactMarkdown>
                        <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
                      </div>
                    </div>
                  </div>
                ) : (
                  // Show loading indicator while waiting for first chunk
                  <div className="flex items-center gap-2 text-gray-500 mt-4">
                    <div className="flex gap-1">
                      <span className="animate-bounce" style={{ animationDelay: "0ms" }}>🌊</span>
                      <span className="animate-bounce" style={{ animationDelay: "150ms" }}>🌊</span>
                      <span className="animate-bounce" style={{ animationDelay: "300ms" }}>🌊</span>
                    </div>
                    <span>Mikey is thinking...</span>
                  </div>
                )
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input - only show at bottom when there are messages */}
        {messages.length > 0 && (
        <div className="border-t border-gray-200 bg-white relative flex flex-col shrink-0 overflow-visible" style={{
          minHeight: 100 +
            ((selectedAttachments.length > 0 || conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded?.length) ? 48 : 0) +
            ((selectedImages.length > 0 || conversations.find(c => c.id === selectedConversation)?.imagesIncluded?.length) ? 110 : 0) +
            (processingStatus ? 44 : 0),
          maxHeight: '50vh'
        }}>
          {/* Resize handle at top */}
          <div
            className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/50 transition-colors z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingInput(true);
            }}
          >
            <div className="absolute -top-1 -bottom-1 left-0 right-0" />
          </div>
          <div className="p-4 flex-1 flex flex-col min-h-0">
          {!user?.canChat ? (
            <div className="max-w-[800px] mx-auto text-center py-4">
              <p className="text-red-600 mb-2">{user?.chatBlockedMessage}</p>
              <a href="/upgrade" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Subscribe to continue
              </a>
            </div>
          ) : (
            <form onSubmit={handleSendMessage} className="max-w-[800px] w-full mx-auto flex-1 flex flex-col min-h-0">
              {/* Merge field preview/warning */}
              {mergeFieldPreview && (
                <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  {mergeFieldPreview.missing.length > 0 && (
                    <div className="flex items-start gap-2 text-orange-600 mb-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                      </svg>
                      <span>
                        Missing variables: <strong>{mergeFieldPreview.missing.join(", ")}</strong>
                        {" "}<a href="/settings" className="text-blue-600 hover:underline">Configure in Settings</a>
                      </span>
                    </div>
                  )}
                  {mergeFieldPreview.used.length > 0 && (
                    <div className="space-y-2">
                      {mergeFieldPreview.used.map((v) => (
                        <div key={v.mergeField} className="text-gray-600">
                          <span className="font-medium text-blue-600">{`{{${v.mergeField}}}`}</span>
                          <span className="text-gray-400 mx-2">→</span>
                          <span className="text-gray-700">{v.value.length > 100 ? v.value.substring(0, 100) + "..." : v.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {isViewingSharedChat ? (
                /* Read-only state for shared chats */
                <div className="border rounded-2xl bg-gray-50 shadow-sm w-full p-4 text-center">
                  <div className="text-gray-500 mb-2">
                    This is a read-only shared chat from{" "}
                    <span className="font-medium text-gray-700">
                      {sharedChatInfo?.sharedBy.name || sharedChatInfo?.sharedBy.email?.split("@")[0] || "someone"}
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/chat/${selectedConversation}/clone`, { method: "POST" });
                        const data = await res.json();
                        if (data.conversationId) {
                          router.push(`/chat/${data.conversationId}`);
                          showToast("Chat cloned! You can now continue this conversation.", "bottom");
                        }
                      } catch {
                        showToast("Failed to clone chat", "bottom");
                      }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Clone to Continue Chatting
                  </button>
                </div>
              ) : (isVoiceRecording || isTTSPlaying) ? (
                <VoiceRecordingInput
                  isActive={isVoiceRecording}
                  isSpeaking={isTTSPlaying}
                  onCancel={() => {
                    voiceConversationModeRef.current = false;
                    setIsVoiceRecording(false);
                    stopTTS();
                  }}
                  onTranscriptionComplete={(text) => {
                    setIsVoiceRecording(false);
                    setIsTTSPlaying(true); // Keep voice UI visible while TTS loads
                    sendVoiceMessageWithTTS(text);
                  }}
                  onStopSpeaking={stopTTS}
                />
              ) : (
                <div
                  className={`relative border rounded-2xl bg-white shadow-sm w-full transition-colors ${isDraggingImage ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}
                  onDrop={handleImageDrop}
                  onDragOver={handleImageDragOver}
                  onDragLeave={handleImageDragLeave}
                >
                  {/* Drag overlay */}
                  {isDraggingImage && (
                    <div className="absolute inset-0 flex items-center justify-center bg-blue-50/80 rounded-2xl z-10 pointer-events-none">
                      <div className="text-blue-600 font-medium flex items-center gap-2">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Drop file here
                      </div>
                    </div>
                  )}
                  {/* Attachment chips and image previews inside card at top - only for pending uploads */}
                  {(conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded?.length ||
                    selectedAttachments.length > 0 || selectedImages.length > 0) && (
                    <div className="px-4 pt-3 rounded-t-2xl space-y-2">
                      {conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded?.length ? (
                        <AttachmentChipsReadOnly
                          attachments={conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded as string[]}
                        />
                      ) : selectedAttachments.length > 0 ? (
                        <AttachmentChips
                          attachments={selectedAttachments}
                          onRemove={(id) => setSelectedAttachments(selectedAttachments.filter(a => a !== id))}
                        />
                      ) : null}
                      {selectedImages.length > 0 ? (
                        <ImagePreviewChips
                          files={selectedImages}
                          onRemove={(index) => setSelectedImages(selectedImages.filter((_, i) => i !== index))}
                          onPreview={(index) => openLightboxForFiles(selectedImages, index)}
                          processing={processingImages}
                        />
                      ) : null}
                    </div>
                  )}
                  {/* Mode selector + processing status row */}
                  <div className="flex items-center justify-between px-4 pt-2">
                    {/* Processing status */}
                    <div className="flex-1">
                      {processingStatus && (
                        <div className="text-sm text-blue-600 flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          {processingStatus}
                        </div>
                      )}
                    </div>

                    {/* Mode selector flags */}
                    <div className="flex items-center gap-1">
                      {/* Founding Sales Content (RAG) flag */}
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => setConversationModeTo("CHATBASE")}
                          disabled={switchingMode}
                          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-all border ${
                            conversationMode === "CHATBASE"
                              ? "bg-blue-50 text-blue-700 border-blue-300"
                              : "text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50"
                          } ${switchingMode ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <span>🌊</span>
                          Founding Sales Content
                        </button>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                          <p>GPT 5.2 on top of a RAG implementation of Founding Sales and all of Pete&apos;s other writings and courses.</p>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                        </div>
                      </div>

                      {/* Direct LLM flag */}
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => setConversationModeTo("DIRECT")}
                          disabled={switchingMode}
                          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-all border ${
                            conversationMode === "DIRECT"
                              ? "bg-orange-50 text-orange-700 border-orange-300"
                              : "text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50"
                          } ${switchingMode ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <span>⚡️</span>
                          Direct LLM
                        </button>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                          <p>Direct GPT 5.2 interaction for larger context window and &ldquo;clean&rdquo; interactions with no RAG involvement.</p>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Full-width textarea */}
                  <textarea
                    ref={chatInputRef}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter submits, Shift+Enter or Cmd+Enter creates new line
                      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        if (inputMessage.trim() && !sending) {
                          handleSendMessage(e);
                        }
                      }
                    }}
                    onPaste={handlePaste}
                    placeholder="Ask Mikey anything about founder-led sales..."
                    className="w-full px-4 py-3 border-0 focus:outline-none focus:ring-0 resize-none min-h-[60px] max-h-[200px] text-[16px] rounded-t-2xl"
                    rows={2}
                    style={{ height: 'auto' }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                    }}
                  />

                  {/* Bottom toolbar */}
                  <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 rounded-b-2xl">
                    {/* Left side - action buttons */}
                    <div className="flex items-center gap-1">
                      {/* GTM Variables Dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowVariablesDropdown(!showVariablesDropdown)}
                          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Insert GTM Variable"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                        </button>
                        {showVariablesDropdown && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowVariablesDropdown(false)}
                            />
                            <div className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-80 overflow-y-auto">
                              <div className="p-2 border-b border-gray-100">
                                <span className="text-xs font-medium text-gray-500 uppercase">Insert Variable</span>
                              </div>
                              {gtmVariables.length === 0 ? (
                                <div className="p-3 text-sm text-gray-500">
                                  No variables configured.{" "}
                                  <a href="/settings" className="text-blue-600 hover:underline">
                                    Add in Settings
                                  </a>
                                </div>
                              ) : (
                                <div className="py-1">
                                  {gtmVariables.map((v) => (
                                    <button
                                      key={v.mergeField}
                                      type="button"
                                      onClick={() => insertVariable(v.mergeField)}
                                      className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center justify-between gap-2"
                                    >
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">{v.name}</div>
                                        <div className="text-xs text-blue-600 font-mono">{`{{${v.mergeField}}}`}</div>
                                      </div>
                                      {v.value ? (
                                        <span className="flex-shrink-0 w-2 h-2 bg-green-500 rounded-full" title="Has value" />
                                      ) : (
                                        <span className="flex-shrink-0 w-2 h-2 bg-orange-400 rounded-full" title="No value set" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="p-2 border-t border-gray-100">
                                <a
                                  href="/settings"
                                  className="text-xs text-gray-500 hover:text-blue-600"
                                >
                                  Manage variables →
                                </a>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                      {/* Attachment Picker */}
                      {!conversations.find(c => c.id === selectedConversation)?.attachmentsIncluded?.length && (
                        <AttachmentPicker
                          selectedAttachments={selectedAttachments}
                          onSelectionChange={setSelectedAttachments}
                          disabled={sending}
                          isFirstMessage={true}
                        />
                      )}
                      {/* Image Attachment Button */}
                      <ImageAttachmentButton
                        onFilesChange={(newFiles: File[]) => setSelectedImages([...selectedImages, ...newFiles])}
                        disabled={sending || processingImages}
                        currentCount={selectedImages.length}
                        maxFiles={4}
                      />
                    </div>

                    {/* Right side - send buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          voiceConversationModeRef.current = true;
                          setIsVoiceRecording(true);
                        }}
                        className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        title="Voice input"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </button>
                      <button
                        type="submit"
                        disabled={!inputMessage.trim() || sending || processingImages}
                        className="p-2 text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        title="Send message"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </form>
          )}
          </div>
        </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50 ${
          toast.position === "left"
            ? "top-16 left-6"
            : toast.position === "bottom"
            ? "bottom-24 left-1/2 -translate-x-1/2 ml-40"
            : "top-16 right-6"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Search Overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-[15vh]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSearchOpen(false);
              setSearchQuery("");
              setSearchSelectedIndex(0);
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
            {/* Search Input */}
            <div className="flex items-center px-5 py-4 border-b border-gray-100">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchSelectedIndex(0); // Reset selection when typing
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search conversations..."
                className="flex-1 text-lg text-gray-900 placeholder-gray-400 outline-none"
              />
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                  setSearchSelectedIndex(0);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* Search Results */}
            <div className="max-h-[60vh] overflow-y-auto">
              {/* New Chat Option - always shown at top */}
              <button
                onClick={handleSearchNewChat}
                className={`w-full px-5 py-4 transition-colors flex items-center gap-4 text-left border-b border-gray-100 ${
                  searchSelectedIndex === 0 ? "bg-gray-100" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex-shrink-0 text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </div>
                <div className="font-medium text-gray-900">New Chat</div>
              </button>

              {searchLoading ? (
                <div className="p-8 text-center text-gray-500">
                  <div className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Searching...</span>
                  </div>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  {searchQuery.trim() ? "No conversations found" : "No recent conversations"}
                </div>
              ) : (
                <div>
                  {searchResults.map((result, index) => (
                    <button
                      key={result.id}
                      onClick={() => handleSearchSelect(result.id)}
                      className={`w-full px-5 py-4 transition-colors flex items-start gap-4 text-left border-b border-gray-100 last:border-b-0 ${
                        searchSelectedIndex === index + 1 ? "bg-gray-100" : "hover:bg-gray-50"
                      }`}
                    >
                      {/* Chat icon */}
                      <div className="flex-shrink-0 mt-1 text-gray-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {result.title || result.preview?.substring(0, 50) || "Untitled conversation"}
                        </div>
                        <div className="text-sm text-gray-500 truncate mt-0.5">
                          {result.matchSnippet
                            ? highlightSearchTerm(result.matchSnippet, searchQuery)
                            : result.preview
                            ? highlightSearchTerm(result.preview.substring(0, 100), searchQuery)
                            : "No preview available"}
                        </div>
                      </div>
                      {/* Date */}
                      <div className="flex-shrink-0 text-sm text-gray-400">
                        {formatRelativeTime(result.lastMessageAt)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Prompt Modal */}
      {editingPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                {isAddingPrompt ? "Add New Prompt" : "Edit Prompt"}
              </h2>

              <div className="space-y-4">
                {/* Emoji picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Emoji
                  </label>
                  <input
                    type="text"
                    value={editingPrompt.emoji}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, emoji: e.target.value.slice(0, 2) })
                    }
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-2xl text-center"
                    maxLength={2}
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Button Title
                  </label>
                  <input
                    type="text"
                    value={editingPrompt.title}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, title: e.target.value })
                    }
                    placeholder="What users see on the button"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    This is what appears on the button tile.
                  </p>
                </div>

                {/* Prompt */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Actual Prompt
                  </label>
                  <textarea
                    value={editingPrompt.prompt}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, prompt: e.target.value })
                    }
                    placeholder="The actual prompt that gets sent to Mikey"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[120px] resize-y"
                    rows={4}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    This is the actual message sent to Mikey. Can be different from the button title to create richer prompts.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-200">
                <div className="flex gap-2">
                  {!isAddingPrompt && canResetPrompt(editingPrompt) && (
                    <button
                      onClick={() => handleResetPromptToDefault(editingPrompt.id)}
                      className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Reset to Default
                    </button>
                  )}
                  {!isAddingPrompt && (
                    <button
                      onClick={async () => {
                        const confirmed = await showConfirm({
                          title: "Archive Prompt",
                          message: "Are you sure you want to archive this prompt? This cannot be undone.",
                          variant: "danger",
                          confirmLabel: "Archive",
                        });
                        if (confirmed) {
                          handleDeletePrompt(editingPrompt.id);
                          setEditingPrompt(null);
                        }
                      }}
                      className="px-3 py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="21 8 21 21 3 21 3 8"></polyline>
                        <rect x="1" y="3" width="22" height="5"></rect>
                        <line x1="10" y1="12" x2="14" y2="12"></line>
                      </svg>
                      Archive
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setEditingPrompt(null);
                      setIsAddingPrompt(false);
                    }}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSavePrompt(editingPrompt)}
                    disabled={!editingPrompt.title.trim() || !editingPrompt.prompt.trim() || savingPrompt}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {savingPrompt ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      isAddingPrompt ? "Add Prompt" : "Save Changes"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rename Conversation Modal */}
      {renamingConversation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                Rename Conversation
              </h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={renamingConversation.title}
                  onChange={(e) =>
                    setRenamingConversation({ ...renamingConversation, title: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !renamingSaving) {
                      handleSaveRename();
                    } else if (e.key === "Escape") {
                      setRenamingConversation(null);
                    }
                  }}
                  placeholder="Enter conversation name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end items-center gap-3 mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setRenamingConversation(null)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRename}
                  disabled={renamingSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {renamingSaving ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Conversation Modal */}
      {showEmailModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowEmailModal(false);
              setEmailAddress("");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowEmailModal(false);
              setEmailAddress("");
            }
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                  </svg>
                </div>
              </div>
              <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
                Email this conversation
              </h2>
              <p className="text-gray-600 text-center mb-6">
                Send a copy of this conversation to any email address.
              </p>

              {user?.email && (
                <button
                  onClick={() => handleEmailConversation(user.email!)}
                  disabled={emailSending}
                  className="w-full mb-3 flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {emailSending ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 2L11 13"></path>
                        <path d="M22 2l-7 20-4-9-9-4 20-7z"></path>
                      </svg>
                      Email to me ({user.email})
                    </>
                  )}
                </button>
              )}

              <div className="relative">
                {user?.email && (
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <span className="text-sm text-gray-400">or send to another email</span>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && emailAddress && !emailSending) {
                        handleEmailConversation(emailAddress);
                      } else if (e.key === "Escape") {
                        setShowEmailModal(false);
                        setEmailAddress("");
                      }
                    }}
                    placeholder="Enter email address"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus={!user?.email}
                  />
                  <button
                    onClick={() => handleEmailConversation(emailAddress)}
                    disabled={!emailAddress || emailSending}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Send
                  </button>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowEmailModal(false);
                  setEmailAddress("");
                }}
                className="w-full mt-4 py-2 text-gray-500 hover:text-gray-700 font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to Slack Modal for Google-only users */}
      {showSlackModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="p-6">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 bg-[#4A154B] rounded-2xl flex items-center justify-center">
                  <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                  </svg>
                </div>
              </div>
              <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
                Use Mikey in your team&apos;s Slack Workspace
              </h2>
              <p className="text-gray-600 text-center mb-6">
                Get sales advice right where your team works. Add Mikey to Slack for instant access to founder-led sales guidance.
              </p>

              <div className="space-y-3">
                <a
                  href="/api/slack/oauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    localStorage.setItem("slackModalDismissed", "true");
                    setShowSlackModal(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#4A154B] text-white font-semibold rounded-lg hover:bg-[#3a1139] transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                  </svg>
                  Add to Slack
                </a>
                <button
                  onClick={() => {
                    localStorage.setItem("slackModalDismissed", "true");
                    setShowSlackModal(false);
                  }}
                  className="w-full py-3 px-4 text-gray-500 hover:text-gray-700 font-medium transition-colors"
                >
                  Maybe later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Google Connection Modal for Slack-only users */}
      <GoogleConnectionModal
        isOpen={showGoogleModal}
        onClose={() => setShowGoogleModal(false)}
        onConnect={() => {
          localStorage.setItem("googleModalDismissed", "true");
          setShowGoogleModal(false);
          window.location.href = "/api/auth/google?link=true";
        }}
      />

      {/* Get Started Modal - prompts new users to create Sales Narrative */}
      <GetStartedModal
        isOpen={showGetStartedModal}
        onClose={() => setShowGetStartedModal(false)}
      />

      {/* Profile Completion Modal */}
      <ProfileCompletionModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSave={async (data) => {
          const res = await fetch("/api/auth/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || "Failed to update profile");
          }
          // Update local user state
          if (user) {
            setUser({
              ...user,
              name: data.name || user.name,
              email: data.email || user.email,
            });
          }
        }}
        missingName={user?.missingName || false}
        missingEmail={user?.missingEmail || false}
        currentName={user?.name || undefined}
        currentEmail={user?.email || undefined}
      />

      {/* GTM Maturity Assessment Modal */}
      <MaturityQuizModal
        isOpen={showMaturityModal}
        onClose={() => setShowMaturityModal(false)}
        onComplete={(conversationId) => {
          setShowMaturityModal(false);
          router.push(`/chat/${conversationId}`);
        }}
        mode={maturityModalMode}
      />

      {/* Image/PDF Lightbox */}
      {lightboxOpen && lightboxImages.length > 0 && (
        <Lightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={setLightboxIndex}
          onDownload={lightboxDownloadData ? handleLightboxDownload : undefined}
        />
      )}

    </div>

    {/* Share Chat Modal */}
    {shareModalConversationId && (
      <ShareChatModal
        conversationId={shareModalConversationId}
        conversationTitle={conversations.find(c => c.id === shareModalConversationId)?.title || undefined}
        isOpen={!!shareModalConversationId}
        onClose={() => setShareModalConversationId(null)}
      />
    )}

    {ConfirmModalElement}
    </div>
  );
}
