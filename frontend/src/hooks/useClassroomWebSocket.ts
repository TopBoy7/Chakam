import { useEffect, useRef, useCallback } from 'react';
import { WS_BASE } from '@/lib/api';

type WSMessageHandler = (data: any) => void;

export const useClassroomWebSocket = (onMessage: WSMessageHandler) => {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Reconnect after 3 seconds
      setTimeout(() => {
        wsRef.current = new WebSocket(`${WS_BASE}/ws`);
      }, 3000);
    };

    wsRef.current = ws;

    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [onMessage]);

  return wsRef.current;
};