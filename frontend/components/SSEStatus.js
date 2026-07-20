'use client';

import { useEffect, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function SSEStatus({ onEvent }) {
  const [status, setStatus] = useState('connecting');
  const [lastEvent, setLastEvent] = useState(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/api/vuelos/events`);

    eventSource.onopen = () => {
      setStatus('connected');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastEvent(data);
        if (onEventRef.current) onEventRef.current(data);
      } catch {
        // Ignorar mensajes que no sean JSON valido
      }
    };

    eventSource.onerror = () => {
      setStatus('connecting');
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const statusText = status === 'connected' ? 'Conectado' : 'Reconectando...';

  return (
    <div className="status-bar">
      <span className={`status-dot ${status === 'connected' ? 'connected' : 'connecting'}`} />
      <span>SSE: {statusText}</span>
      {lastEvent && lastEvent.vuelo_id && (
        <span>— Ultimo evento: {lastEvent.evento} ({lastEvent.vuelo_id})</span>
      )}
    </div>
  );
}
