import { getSession } from "@/lib/auth";
import { eventBus } from "@/lib/event-bus";

export const dynamic = "force-dynamic";

// A stream never ends by itself, and `next start` waits for every open connection before it exits
// on SIGTERM, so a restart would hang until systemd kills it. End them all when shutdown begins.
const openStreams = new Set<() => void>();
let closesOnShutdown = false;

export async function GET() {
  const user = await getSession();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  console.info("[events] SSE connection opened for user", user.id);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let end: (() => void) | null = null;

  if (!closesOnShutdown) {
    closesOnShutdown = true;
    process.once("SIGTERM", () => openStreams.forEach((close) => close()));
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      end = () => {
        closed = true;
        if (heartbeatId) clearInterval(heartbeatId);
        if (unsubscribe) unsubscribe();
        openStreams.delete(end!);
        try { controller.close(); } catch { /* already closed */ }
      };
      openStreams.add(end);

      heartbeatId = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          closed = true;
          if (heartbeatId) clearInterval(heartbeatId);
          if (unsubscribe) unsubscribe();
        }
      }, 15000);

      unsubscribe = eventBus.subscribe((event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`));
        } catch {
          closed = true;
          if (heartbeatId) clearInterval(heartbeatId);
          if (unsubscribe) unsubscribe();
        }
      });
    },
    cancel() {
      console.info("[events] SSE connection closed for user", user.id);
      closed = true;
      if (heartbeatId) clearInterval(heartbeatId);
      if (unsubscribe) unsubscribe();
      if (end) openStreams.delete(end);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      // The stream is the connection's only response, so ending it drops the socket at once.
      Connection: "close",
      "X-Accel-Buffering": "no",
    },
  });
}
