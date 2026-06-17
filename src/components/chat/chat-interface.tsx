"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Copy, Check, Paperclip, X, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useEvent } from "@/lib/use-events";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyToClipboard } from "@/lib/clipboard";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sender?: string;
  image_thumb?: string;
}

interface Reaction {
  emoji: string;
  count: number;
  users: string[];
  mine: boolean;
}

const REACTION_EMOJIS = ["\uD83D\uDC4D", "\uD83D\uDC4E", "\uD83D\uDE00", "\uD83D\uDE02", "\u2764\uFE0F", "\uD83D\uDE2E", "\uD83C\uDF89"];

export function ChatInterface() {
  const { t } = useLocale();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [chatImage, setChatImage] = useState<string | null>(null);
  const [chatImagePreview, setChatImagePreview] = useState<string | null>(null);
  const [chatImageType, setChatImageType] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageCountRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      const viewport = el.querySelector("[data-slot=scroll-area-viewport]") || el.firstElementChild;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  // Load messages and start polling
  useEffect(() => {
    console.debug("[chat] Loading messages and user");
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) setCurrentUser(d.user.display_name || d.user.email);
    }).catch(() => {});

    fetch("/api/chat/messages")
      .then((r) => r.json())
      .then((data) => {
        if (data.messages?.length > 0) {
          console.info("[chat] Loaded", data.messages.length, "messages, hasOlder:", data.hasOlder);
          const msgs = data.messages.map((m: { id: number; role: string; content: string; sender?: string; image_thumb?: string }) => ({
            id: m.id.toString(),
            role: m.role as "user" | "assistant",
            content: m.content,
            sender: m.sender,
            image_thumb: m.image_thumb || undefined,
          }));
          setMessages(msgs);
          setHasOlder(!!data.hasOlder);
          if (data.reactions) setReactions((prev) => ({ ...prev, ...data.reactions }));
          messageCountRef.current = msgs.length;
          // If last message is from user, AI is still thinking
          if (msgs.length > 0 && msgs[msgs.length - 1].role === "user") {
            setLoading(true);
          }
        } else {
          const greeting = t.chat.greeting;
          setMessages([{ id: "greeting", role: "assistant", content: greeting }]);
          fetch("/api/chat/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "assistant", content: greeting }),
          }).catch(() => {});
          messageCountRef.current = 1;
        }
      })
      .catch(() => {
        setMessages([{ id: "greeting", role: "assistant", content: t.chat.greeting }]);
      })
      .finally(() => {
        setInitialLoading(false);
        setTimeout(scrollToBottom, 100);
      });

  }, []);

  // iOS Safari suspends the in-flight POST and the SSE stream while the app is backgrounded, so a
  // reply that finishes generating in the background is saved server-side but never reaches the
  // client. Re-fetch the latest messages when the page becomes visible again to pick those up.
  useEffect(() => {
    const syncOnVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      fetch("/api/chat/messages")
        .then((r) => r.json())
        .then((data) => {
          if (!data.messages?.length) return;
          const msgs: Message[] = data.messages.map((m: { id: number; role: string; content: string; sender?: string; image_thumb?: string }) => ({
            id: m.id.toString(),
            role: m.role as "user" | "assistant",
            content: m.content,
            sender: m.sender,
            image_thumb: m.image_thumb || undefined,
          }));
          setMessages((prev) => {
            const known = new Set(prev.map((p) => p.id));
            const additions = msgs.filter((m) => !known.has(m.id) && !prev.some((p) => p.role === m.role && p.content === m.content));
            if (additions.length === 0) return prev;
            messageCountRef.current += additions.length;
            return [...prev, ...additions];
          });
          if (data.reactions) setReactions((prev) => ({ ...prev, ...data.reactions }));
          // If the newest server message is an assistant reply, the AI is no longer "thinking".
          if (msgs[msgs.length - 1]?.role === "assistant") setLoading(false);
          setTimeout(scrollToBottom, 50);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", syncOnVisible);
    window.addEventListener("focus", syncOnVisible);
    window.addEventListener("pageshow", syncOnVisible);
    return () => {
      document.removeEventListener("visibilitychange", syncOnVisible);
      window.removeEventListener("focus", syncOnVisible);
      window.removeEventListener("pageshow", syncOnVisible);
    };
  }, [scrollToBottom]);

  // SSE: receive new chat messages in real time
  useEvent("chat:message", useCallback((data: unknown) => {
    const msg = data as { id: number; role: string; content: string; sender: string | null; userId: number | null };
    console.debug("[chat] SSE message received:", msg.role, msg.sender);
    setMessages((prev) => {
      // Avoid duplicates — check by DB id OR by matching content+role (optimistic vs SSE)
      if (prev.some((m) => m.id === String(msg.id) || (m.content === msg.content && m.role === msg.role))) return prev;
      return [...prev, {
        id: String(msg.id),
        role: msg.role as "user" | "assistant",
        content: msg.content,
        sender: msg.sender || undefined,
      }];
    });
    messageCountRef.current++;
    if (msg.role === "assistant") setLoading(false);
    setTimeout(scrollToBottom, 50);
  }, [scrollToBottom]));

  // SSE: receive typing indicators in real time
  useEvent("chat:typing", useCallback((data: unknown) => {
    const typing = data as { userId: number; name: string; typing: boolean };
    setTypingUsers((prev) => {
      if (typing.typing) {
        return prev.includes(typing.name) ? prev : [...prev, typing.name];
      }
      return prev.filter((n) => n !== typing.name);
    });
  }, []));

  // SSE: receive reaction updates in real time
  useEvent("chat:reaction", useCallback((data: unknown) => {
    const { messageId, reactions: rxns } = data as { messageId: number; reactions: Reaction[] };
    setReactions((prev) => ({ ...prev, [messageId]: rxns }));
  }, []));

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      const res = await fetch("/api/chat/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: parseInt(messageId, 10), emoji }),
      });
      const data = await res.json();
      if (data.reactions) {
        setReactions((prev) => ({ ...prev, [messageId]: data.reactions }));
      }
    } catch (err) {
      console.error("[chat] Failed to toggle reaction:", err);
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Broadcast typing status
  const broadcastTyping = useCallback(() => {
    fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ typing: true }),
    }).catch(() => {});

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      fetch("/api/chat/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typing: false }),
      }).catch(() => {});
    }, 4000);
  }, []);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder || messages.length === 0) return;
    const oldestId = messages[0]?.id;
    if (!oldestId || oldestId === "greeting") return;

    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/chat/messages?before=${oldestId}`);
      const data = await res.json();
      if (data.messages?.length > 0) {
        const older = data.messages.map((m: { id: number; role: string; content: string; sender?: string; image_thumb?: string }) => ({
          id: m.id.toString(),
          role: m.role as "user" | "assistant",
          content: m.content,
          sender: m.sender,
          image_thumb: m.image_thumb || undefined,
        }));
        setMessages((prev) => [...older, ...prev]);
        setHasOlder(!!data.hasOlder);
        if (data.reactions) setReactions((prev) => ({ ...prev, ...data.reactions }));
        console.info("[chat] Loaded", older.length, "older messages, hasOlder:", data.hasOlder);
      } else {
        setHasOlder(false);
      }
    } catch (err) {
      console.error("[chat] Failed to load older messages:", err);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasOlder, messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userContent = input.trim();
    const thumb = chatImagePreview || undefined;
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userContent,
      sender: currentUser,
      image_thumb: thumb,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    // Stop typing indicator
    fetch("/api/chat/typing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typing: false }) }).catch(() => {});

    // Save user message with thumbnail
    try {
      await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: userContent, image_thumb: thumb }),
      });
      messageCountRef.current++;
    } catch {}

    // Fire AI request (include image if attached)
    const chatBody: Record<string, unknown> = {
      messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
    };
    if (chatImage) {
      chatBody.image = chatImage;
      chatBody.image_media_type = chatImageType;
      const lc = userContent.toLowerCase();
      chatBody.add_expense = lc.includes("lisää") || lc.includes("add expense") || lc.includes("add cost") || lc.includes("lisää kulu") || lc.includes("kirjaa");
      setChatImage(null);
      setChatImagePreview(null);
      setChatImageType("");
    }

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody),
    })
      .then((r) => r.json())
      .then((data) => {
        // Add from fetch response if SSE hasn't delivered it yet (dedup prevents doubles)
        if (data.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.role === "assistant" && m.content === data.message)) return prev;
            console.info("[chat] Adding assistant message from fetch response");
            return [...prev, { id: `fallback-${Date.now()}`, role: "assistant" as const, content: data.message }];
          });
          setLoading(false);
        }
      })
      .catch(() => {
        console.warn("[chat] AI request failed");
        setLoading(false);
      });
  };

  if (initialLoading) {
    return (
      <div className="chat-container">
        <div className="chat-loading-center">
          <div className="typing-dots"><span /><span /><span /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <ScrollArea className="chat-messages" ref={scrollRef}>
        <div className="chat-messages-list">
          {hasOlder && (
            <div className="chat-load-older">
              <button type="button" className="chat-load-older-btn" onClick={loadOlder} disabled={loadingOlder}>
                <ChevronUp />
                {loadingOlder ? "..." : (t.chat.loadOlder || "Load older")}
              </button>
            </div>
          )}
          {messages.map((message) => {
            const isSelf = message.role === "user" && message.sender === currentUser;
            const isOtherUser = message.role === "user" && message.sender !== currentUser;
            const bubbleType = message.role === "assistant" ? "assistant" : isSelf ? "self" : "other";

            return (
            <div key={message.id} className="chat-message" data-type={bubbleType}>
              {bubbleType !== "self" && (
                <div className="chat-message-avatar" data-type={bubbleType}>
                  {message.role === "assistant" ? <Bot /> : <User />}
                </div>
              )}
              <div className="chat-message-bubble" data-type={bubbleType}>
                {message.image_thumb && (
                  message.image_thumb === "pdf"
                    ? <span className="chat-pdf-badge">PDF</span>
                    : message.image_thumb.startsWith("data:application/pdf")
                      ? <object data={message.image_thumb} type="application/pdf" className="chat-pdf-preview">{/* PDF */}</object>
                      : <img src={message.image_thumb} alt="" className="chat-bubble-image" />
                )}
                {message.role === "assistant" && (
                  <div className="chat-message-sender" data-type="assistant">Dougie</div>
                )}
                {isOtherUser && message.sender && (
                  <div className="chat-message-sender">{message.sender}</div>
                )}
                <div className="chat-message-text">
                  {message.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      strong: ({ children }) => {
                        const text = String(children);
                        const hasEuro = text.includes("€");
                        if (!hasEuro) return <strong>{children}</strong>;
                        // Only short amounts get nowrap, long text with amounts stays wrappable
                        if (text.length <= 20) {
                          const hasMinus = text.includes("-") || text.includes("\u2212");
                          const hasPercent = text.includes("%");
                          const cls = hasMinus ? "chat-amount-negative" : hasPercent ? "chat-amount-neutral" : "chat-amount-positive";
                          return <strong className={cls}>{children}</strong>;
                        }
                        return <strong>{children}</strong>;
                      }
                    }}>{message.content}</ReactMarkdown>
                  ) : message.content}
                </div>
                {message.role === "assistant" && (
                  <button
                    type="button"
                    className="chat-copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(message.content).then(() => {
                        setCopiedId(message.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      });
                    }}
                  >
                    {copiedId === message.id ? <Check /> : <Copy />}
                  </button>
                )}
                <div className="chat-reaction-picker">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button key={emoji} type="button" className="chat-reaction-pick" onClick={() => toggleReaction(message.id, emoji)}>{emoji}</button>
                  ))}
                </div>
                {reactions[message.id]?.length > 0 && (
                  <div className="chat-reactions">
                    {reactions[message.id].map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        className={`chat-reaction-badge ${r.mine ? "is-mine" : ""}`}
                        onClick={() => toggleReaction(message.id, r.emoji)}
                      >
                        {r.emoji} <span>{r.count}</span>
                        <div className="chat-reaction-tooltip">
                          {r.users.length === 1
                            ? `${r.users[0]} reacted with ${r.emoji}`
                            : `${r.users.join(" and ")} reacted with ${r.emoji}`}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {bubbleType === "self" && (
                <div className="chat-message-avatar" data-type="self"><User /></div>
              )}
            </div>
            );
          })}
          {loading && (
            <div className="chat-loading">
              <div className="chat-message-avatar" data-type="assistant"><Bot /></div>
              <div className="chat-loading-bubble">
                <div className="typing-dots"><span /><span /><span /></div>
              </div>
            </div>
          )}
          {typingUsers.length > 0 && !loading && (
            <div className="chat-typing-indicator">
              {typingUsers.join(", ")} {t.chat.typing || "is typing..."}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="chat-input-area">
        {chatImagePreview && (
          <div className="chat-image-preview">
            {chatImagePreview.startsWith("data:application/pdf")
              ? <object data={chatImagePreview} type="application/pdf" className="chat-pdf-preview">{/* PDF */}</object>
              : <img src={chatImagePreview} alt="Attached" />}
            <button type="button" className="chat-image-remove" onClick={() => { setChatImage(null); setChatImagePreview(null); setChatImageType(""); }}>
              <X />
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="chat-input-form">
          <input
            ref={chatFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              console.info("[chat] File attached:", file.name, file.type);
              setChatImageType(file.type);
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                setChatImage(dataUrl.split(",")[1]);
                // For images, create a small thumbnail for persistence. For PDFs, use a placeholder.
                if (file.type.startsWith("image/")) {
                  const img = new Image();
                  img.onload = () => {
                    const canvas = document.createElement("canvas");
                    const maxSize = 200;
                    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
                    setChatImagePreview(canvas.toDataURL("image/jpeg", 0.7));
                  };
                  img.src = dataUrl;
                } else if (file.type === "application/pdf") {
                  setChatImagePreview(dataUrl);
                }
              };
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
          />
          <div className={`chat-input-wrap ${inputExpanded ? "is-expanded" : ""}`}>
            <textarea
              ref={inputRef as unknown as React.RefObject<HTMLTextAreaElement>}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (!inputExpanded) {
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                }
                if (e.target.value.length > 0) broadcastTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
                if (e.key === "Escape" && inputExpanded) {
                  setInputExpanded(false);
                }
              }}
              placeholder={t.chat.placeholder}
              className="chat-textarea"
              disabled={loading}
              rows={1}
            />
            <div className="chat-inline-actions">
              <button type="button" className="chat-inline-btn" onClick={() => chatFileRef.current?.click()} disabled={loading}>
                <Paperclip />
              </button>
              <button type="button" className="chat-inline-btn" onClick={() => setInputExpanded(!inputExpanded)}>
                {inputExpanded ? <Minimize2 /> : <Maximize2 />}
              </button>
            </div>
          </div>
          <Button type="submit" size="icon" className="chat-send-button" disabled={!input.trim() || loading}>
            <Send />
          </Button>
        </form>
      </div>
    </div>
  );
}
