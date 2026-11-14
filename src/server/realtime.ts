/**
 * Real-time channel to the dashboard.
 *
 * The WebSocket server is created once at boot and shared, so routes and the
 * background collector can all broadcast without importing the HTTP server.
 */
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "./logger.ts";

let wss: WebSocketServer | null = null;

/** Attaches the WebSocket server to the running HTTP server. */
export function attachWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    logger.info("[WS] Client connected");
    ws.send(JSON.stringify({ type: "SYSTEM_CONNECTED", data: { message: "Connected to S.M.I.P" } }));

    ws.on("close", () => logger.info("[WS] Client disconnected"));
  });

  return wss;
}

/**
 * Sends an event to every connected dashboard.
 *
 * A broadcast must never take down a request handler, so a failing socket is
 * logged and skipped rather than thrown.
 */
export function broadcast(type: string, data: any) {
  if (!wss) return;
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch (err) {
        logger.warn("[WS] Broadcast failed:", err);
      }
    }
  });
}

/** Closes every dashboard connection during shutdown. */
export function closeWebSocketServer() {
  wss?.clients.forEach((client) => client.close(1001, "Server shutting down"));
}
