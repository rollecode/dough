"use client";

import { useEffect, useRef, useCallback, useLayoutEffect } from "react";

type EventType = "chat:message" | "chat:typing" | "chat:reaction" | "sync:complete" | "data:updated";
type EventHandler = (data: unknown) => void;

const handlers = new Map<EventType, Set<EventHandler>>();
let eventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let subscriberCount = 0;

function connect() {
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;

  console.debug("[sse] Connecting to /api/events");
  eventSource = new EventSource("/api/events");

  eventSource.onopen = () => {
    console.info("[sse] Connected");
  };

  eventSource.onerror = () => {
    console.warn("[sse] Connection error, reconnecting in 3s");
    eventSource?.close();
    eventSource = null;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connect, 3000);
  };

  // Listen for all event types
  const eventTypes: EventType[] = ["chat:message", "chat:typing", "chat:reaction", "sync:complete", "data:updated"];
  for (const type of eventTypes) {
    eventSource.addEventListener(type, (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const typeHandlers = handlers.get(type);
        if (typeHandlers) {
          for (const handler of typeHandlers) {
            handler(data);
          }
        }
      } catch (err) {
        console.error("[sse] Parse error:", err);
      }
    });
  }
}

function disconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  eventSource?.close();
  eventSource = null;
  console.debug("[sse] Disconnected");
}

export function useEvent(type: EventType, handler: EventHandler) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => { handlerRef.current = handler; });

  const stableHandler = useCallback((data: unknown) => {
    handlerRef.current(data);
  }, []);

  useEffect(() => {
    subscriberCount++;
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(stableHandler);

    // Connect if this is the first subscriber
    if (subscriberCount === 1) connect();

    return () => {
      handlers.get(type)?.delete(stableHandler);
      subscriberCount--;
      // Disconnect if no more subscribers
      if (subscriberCount === 0) disconnect();
    };
  }, [type, stableHandler]);
}
