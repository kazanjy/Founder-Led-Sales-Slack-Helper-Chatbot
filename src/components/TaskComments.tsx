"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const RichTextCommentEditor = dynamic(
  () => import("@/components/RichTextCommentEditor"),
  { ssr: false }
);

interface CommentAuthor {
  id: string;
  name: string | null;
  slackUserName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  author: CommentAuthor;
}

interface TaskCommentsProps {
  taskId: string;
  canEdit: boolean;
  /**
   * Optional override. If absent, the component reads the caller's
   * id from the GET /comments response — that's the authoritative
   * value and the one to trust.
   */
  currentUserId?: string | null;
}

function authorDisplay(a: CommentAuthor): string {
  return a.name || a.slackUserName || a.email?.split("@")[0] || "Someone";
}

function authorInitial(a: CommentAuthor): string {
  return authorDisplay(a).charAt(0).toUpperCase() || "?";
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function TaskComments({ taskId, canEdit, currentUserId: currentUserIdProp }: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [serverCurrentUserId, setServerCurrentUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // The id we compare to comment.author.id to decide which rows are
  // "own" (and therefore editable/deletable). Prefer the explicit
  // prop if a caller provided one; otherwise use what the server
  // tells us at load time.
  const currentUserId = currentUserIdProp ?? serverCurrentUserId;

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/coaching/tasks/${taskId}/comments`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setComments(data.comments || []);
        if (typeof data.currentUserId === "string") setServerCurrentUserId(data.currentUserId);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // If the page URL points at one of our comments via #comment-X,
  // auto-expand and scroll into view.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#comment-")) return;
    const target = hash.slice("#comment-".length);
    if (!comments.some((c) => c.id === target)) return;
    setExpanded(true);
    // Defer the scroll until after the expanded list paints.
    setTimeout(() => {
      document.getElementById(`comment-${target}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 60);
  }, [comments]);

  const total = comments.length;

  const submitDraft = async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/coaching/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.comment) {
        setComments((prev) => [...prev, data.comment]);
        setDraft("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (c: Comment) => {
    if (currentUserId !== c.author.id) return;
    setEditingId(c.id);
    setEditingBody(c.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingBody("");
  };

  const saveEdit = async (id: string) => {
    const body = editingBody.trim();
    if (!body) return cancelEdit();
    setSavingEditId(id);
    try {
      const res = await fetch(`/api/coaching/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.comment) {
        setComments((prev) => prev.map((c) => (c.id === id ? data.comment : c)));
        cancelEdit();
      }
    } finally {
      setSavingEditId(null);
    }
  };

  const deleteComment = async (id: string) => {
    if (!confirm("Delete this comment? This can't be undone.")) return;
    const res = await fetch(`/api/coaching/comments/${id}`, { method: "DELETE" });
    if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const copyAnchor = (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#comment-${id}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  // Don't render anything until the initial fetch finishes — avoids a
  // flash of "Add comment" before we know whether there are any.
  if (!loaded) return null;

  // Empty + read-only viewer: render nothing rather than a useless
  // "0 comments" badge.
  if (total === 0 && !canEdit) return null;

  // Collapsed view.
  if (!expanded) {
    return (
      <div className="mt-1.5">
        <button
          onClick={() => {
            setExpanded(true);
            // The TipTap editor below picks up focus via its own
            // internal autofocus when it mounts; the click that
            // expanded the section is already a user gesture, so the
            // browser is happy to honor focus().
          }}
          className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:underline inline-flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {total === 0 ? "Add comment" : total === 1 ? "1 comment" : `${total} comments`}
        </button>
      </div>
    );
  }

  // Expanded view.
  return (
    <div className="mt-2 border-l-2 border-gray-100 dark:border-gray-700 pl-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {total === 0 ? "Comments" : total === 1 ? "1 comment" : `${total} comments`}
        </span>
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
        >
          Hide
        </button>
      </div>

      {comments.map((c) => {
        const isOwn = currentUserId === c.author.id;
        const isEditing = editingId === c.id;
        return (
          <div
            key={c.id}
            id={`comment-${c.id}`}
            className="group flex gap-2 scroll-mt-20"
          >
            {/* Avatar */}
            {c.author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.author.avatarUrl}
                alt={authorDisplay(c.author)}
                className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5"
              />
            ) : (
              <div className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-medium flex items-center justify-center">
                {authorInitial(c.author)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                  {authorDisplay(c.author)}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {formatRelative(c.createdAt)}
                  {c.editedAt ? " · edited" : ""}
                </span>
                <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copyAnchor(c.id)}
                    title={copiedId === c.id ? "Copied!" : "Copy link"}
                    className="p-0.5 text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
                  >
                    {copiedId === c.id ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    )}
                  </button>
                  {isOwn && !isEditing && (
                    <button
                      onClick={() => deleteComment(c.id)}
                      title="Delete"
                      className="p-0.5 text-gray-400 hover:text-red-600"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}>
                  <RichTextCommentEditor
                    value={editingBody}
                    onChange={setEditingBody}
                    onSubmit={() => saveEdit(c.id)}
                    autoFocus
                    minHeight={56}
                    placeholder="Edit comment…"
                  />
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => saveEdit(c.id)}
                      disabled={savingEditId === c.id || !editingBody.trim()}
                      className="text-[11px] text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50"
                    >
                      {savingEditId === c.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-[11px] text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                    <span className="text-[10px] text-gray-400 ml-auto">⌘↵ to save · Esc to cancel</span>
                  </div>
                </div>
              ) : (
                <div
                  onClick={(e) => {
                    if (!isOwn) return;
                    if (e.target instanceof HTMLAnchorElement) return;
                    startEdit(c);
                  }}
                  className={`text-sm text-gray-700 dark:text-gray-200 break-words prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 ${isOwn ? "cursor-text hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 -mx-1" : ""}`}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children, ...rest }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-600 hover:text-purple-800 underline break-all"
                          onClick={(e) => e.stopPropagation()}
                          {...rest}
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {c.body}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {canEdit && (
        <div className="pt-1">
          <RichTextCommentEditor
            value={draft}
            onChange={setDraft}
            onSubmit={submitDraft}
            placeholder="Add a comment…"
            minHeight={56}
            autoFocus={total === 0}
          />
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={submitDraft}
              disabled={!draft.trim() || submitting}
              className="text-[11px] text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50"
            >
              {submitting ? "Posting…" : "Post"}
            </button>
            <span className="text-[10px] text-gray-400 ml-auto">⌘↵ to post</span>
          </div>
        </div>
      )}
    </div>
  );
}
