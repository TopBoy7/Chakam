import { useEffect, useRef } from "react";

/*
 Robust reconnecting websocket hook with logging and periodic ping.
 Expects VITE_WS_URL in frontend env (e.g. ws://localhost:8000) or will derive from current location.
*/
const WS_ENV = (import.meta as any).env?.VITE_WS_URL;

// prefer env, fallback to explicit backend host so we don't try the frontend host by mistake
const buildUrl = () => {
  if (WS_ENV) {
    return WS_ENV.replace(/\/+$/, "") + "/ws";
  }
  // fallback to local backend port used by uvicorn
  return "ws://localhost:8000/ws";
};

type WSMessageHandler = (data: any) => void;

export const useClassroomWebSocket = (onMessage: WSMessageHandler) => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const shouldReconnect = useRef(true);

  useEffect(() => {
    const url = buildUrl();
    let backoff = 1000;

    const createSocket = () => {
      console.info("[WS] connecting to", url);
      const ws = new WebSocket(url);
      

      ws.onopen = () => {
        console.info("[WS] open");
        backoff = 1000;
        // send an initial hello so backend receive_text() logs it
        try {
          ws.send(JSON.stringify({ type: "hello", ts: Date.now() }));
        } catch (e) {
          console.warn("[WS] send hello failed", e);
        }
        // ping every 25s
        if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
              // console.debug("[WS] ping");
            } catch (e) {
              console.warn("[WS] ping failed", e);
            }
          }
        }, 25000);
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          console.info("[WS] message", data.event ?? data);
          onMessage(data);
        } catch (err) {
          console.error("[WS] failed to parse message", err, ev.data);
        }
      };

      ws.onerror = (err) => {
        console.error("[WS] error", err);
      };

      ws.onclose = (ev) => {
        console.warn("[WS] closed", ev.code, ev.reason);
        if (pingIntervalRef.current) {
          window.clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        wsRef.current = null;
        if (shouldReconnect.current) {
          const t = Math.min(backoff, 30000);
          console.info(`[WS] reconnecting in ${t}ms`);
          reconnectRef.current = window.setTimeout(() => {
            backoff = backoff * 1.5;
            createSocket();
          }, t);
        }
      };

      wsRef.current = ws;
    };

    createSocket();

    return () => {
      shouldReconnect.current = false;
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (pingIntervalRef.current) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.close();
        } catch {}
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMessage]);

  return wsRef.current;
};

export default useClassroomWebSocket;