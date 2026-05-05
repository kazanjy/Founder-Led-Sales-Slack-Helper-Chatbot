"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/core";

interface RichTextCommentEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Optional: ⌘/Ctrl-Enter to submit. */
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** Min visible height in px before the editor grows with content. */
  minHeight?: number;
}

function ToolbarButton({
  onClick,
  isActive,
  title,
  children,
}: {
  onClick: () => void;
  isActive?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Prevent the editor from losing focus on click — important
      // because the comment editors auto-cancel on blur in some flows.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 rounded text-[11px] transition-colors ${
        isActive
          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

export default function RichTextCommentEditor({
  value,
  onChange,
  placeholder = "Add a comment…",
  onSubmit,
  autoFocus = false,
  minHeight = 64,
}: RichTextCommentEditorProps) {
  const getMarkdown = (editor: Editor) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (editor.storage as any).markdown.getMarkdown() as string;
  };

  const handleUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      onChange(getMarkdown(editor));
    },
    [onChange]
  );

  const editor = useEditor({
    extensions: [
      // Comments are short — drop heading/codeBlock/horizontalRule from
      // the StarterKit defaults to keep the formatting palette small.
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-purple-600 hover:text-purple-800 underline break-all",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    autofocus: autoFocus ? "end" : false,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          "prose dark:prose-invert max-w-none prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 focus:outline-none px-2 py-1.5 text-sm",
      },
      handleKeyDown: (_view, event) => {
        if (onSubmit && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onSubmit();
          return true;
        }
        return false;
      },
    },
  });

  // Keep TipTap content in sync if the parent resets `value` (e.g.,
  // after submitting a comment we clear the draft to "").
  useEffect(() => {
    if (!editor) return;
    if (value === getMarkdown(editor)) return;
    editor.commands.setContent(value);
  }, [editor, value]);

  return (
    <div className="border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-transparent">
      {editor && (
        <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-gray-100 dark:border-gray-700">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            title="Bold (⌘B)"
          >
            <span className="font-bold">B</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            title="Italic (⌘I)"
          >
            <span className="italic">I</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive("strike")}
            title="Strikethrough"
          >
            <span className="line-through">S</span>
          </ToolbarButton>
          <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-600 mx-0.5" />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
            title="Bullet list"
          >
            • List
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
            title="Numbered list"
          >
            1. List
          </ToolbarButton>
          <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-600 mx-0.5" />
          <ToolbarButton
            onClick={() => {
              if (editor.isActive("link")) {
                editor.chain().focus().unsetLink().run();
                return;
              }
              const url = window.prompt("Link URL:");
              if (!url) return;
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url })
                .run();
            }}
            isActive={editor.isActive("link")}
            title="Link"
          >
            <svg className="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </ToolbarButton>
        </div>
      )}
      <div style={{ minHeight }} className="cursor-text">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
