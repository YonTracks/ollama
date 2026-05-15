"use client";

import { Check, Edit3, MessageSquare, PanelLeftClose, Plus, Settings, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { ChatInfo } from "@/lib/ollama/types";

interface SidebarProps {
  chats: ChatInfo[];
  activeChatId: string | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle(open: boolean): void;
  onNewChat(): void;
  onSelectChat(chatId: string): void;
  onRenameChat(chatId: string, title: string): Promise<void>;
  onDeleteChat(chatId: string): Promise<void>;
  onOpenSettings(): void;
}

export function Sidebar({
  chats,
  activeChatId,
  loading,
  error,
  open,
  onToggle,
  onNewChat,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
  onOpenSettings
}: SidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingChatId]);

  const groupedChats = useMemo(() => {
    const today: ChatInfo[] = [];
    const recent: ChatInfo[] = [];
    const older: ChatInfo[] = [];
    const now = new Date();
    const todayKey = now.toDateString();
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    for (const chat of chats) {
      const updated = new Date(chat.updatedAt);
      if (updated.toDateString() === todayKey) today.push(chat);
      else if (updated.getTime() > weekAgo) recent.push(chat);
      else older.push(chat);
    }

    return [
      { label: "Today", chats: today },
      { label: "This week", chats: recent },
      { label: "Earlier", chats: older }
    ].filter((group) => group.chats.length > 0);
  }, [chats]);

  const saveRename = async () => {
    if (!editingChatId) return;
    const title = editTitle.trim();
    setEditingChatId(null);
    setEditTitle("");

    if (title) {
      await onRenameChat(editingChatId, title);
    }
  };

  return (
    <aside
      className={cn(
        "absolute inset-y-0 left-0 z-30 flex w-[18rem] flex-col border-r border-border bg-panel/98 shadow-panel transition-transform duration-200 md:relative md:translate-x-0 md:shadow-none",
        open ? "translate-x-0" : "-translate-x-full md:w-0 md:overflow-hidden md:border-r-0"
      )}
    >
      <div className="flex h-16 flex-none items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground transition hover:bg-accent/90 focus:focus-ring"
        >
          <Plus className="h-4 w-4 flex-none" />
          <span className="truncate">New chat</span>
        </button>
        <IconButton label="Hide sidebar" onClick={() => onToggle(false)}>
          <PanelLeftClose className="h-5 w-5" />
        </IconButton>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {loading ? (
          <SidebarNotice>Loading conversations</SidebarNotice>
        ) : error ? (
          <SidebarNotice tone="danger">{error}</SidebarNotice>
        ) : chats.length === 0 ? (
          <SidebarNotice>No conversations yet</SidebarNotice>
        ) : (
          groupedChats.map((group) => (
            <div key={group.label} className="mb-5">
              <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.chats.map((chat) => {
                  const active = chat.id === activeChatId;
                  const editing = chat.id === editingChatId;

                  return (
                    <div
                      key={chat.id}
                      className={cn(
                        "group rounded-md border border-transparent",
                        active && "border-accent/25 bg-accent/10"
                      )}
                    >
                      {editing ? (
                        <form
                          className="flex items-center gap-1 p-1"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveRename();
                          }}
                        >
                          <input
                            ref={inputRef}
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                            onBlur={saveRename}
                            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm focus:focus-ring"
                          />
                          <IconButton label="Save title" className="h-9 w-9" onClick={saveRename}>
                            <Check className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label="Cancel"
                            className="h-9 w-9"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setEditingChatId(null)}
                          >
                            <X className="h-4 w-4" />
                          </IconButton>
                        </form>
                      ) : (
                        <div className="flex items-start gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectChat(chat.id)}
                            className="min-w-0 flex-1 rounded-md px-2 py-2 text-left transition hover:bg-muted focus:focus-ring"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <MessageSquare className="h-4 w-4 flex-none text-muted-foreground" />
                              <span className="truncate text-sm font-medium">
                                {chat.title || "Untitled chat"}
                              </span>
                            </div>
                            <div className="mt-1 truncate pl-6 text-xs text-muted-foreground">
                              {chat.userExcerpt || formatRelativeTime(chat.updatedAt)}
                            </div>
                          </button>
                          <div className="flex flex-none opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                            <IconButton
                              label="Rename chat"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditingChatId(chat.id);
                                setEditTitle(chat.title);
                              }}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton
                              label="Delete chat"
                              variant="danger"
                              className="h-8 w-8"
                              onClick={() => {
                                if (window.confirm("Remove this chat?")) {
                                  onDeleteChat(chat.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-none items-center gap-2 border-t border-border p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-panel-strong px-3 text-sm text-muted-foreground transition hover:text-foreground focus:focus-ring"
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function SidebarNotice({
  children,
  tone = "muted"
}: {
  children: React.ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "muted" && "border-border bg-muted/40 text-muted-foreground",
        tone === "danger" && "border-danger/30 bg-danger/10 text-danger"
      )}
    >
      {children}
    </div>
  );
}
