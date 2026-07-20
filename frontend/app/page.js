'use client';

import { useState } from 'react';
import FlightForm from '@/components/FlightForm';
import FlightList from '@/components/FlightList';
import SSEStatus from '@/components/SSEStatus';

export default function Home() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleFlightCreated = () => {
    // Disparar recarga de la lista tras un pequeño retardo
    // para dar tiempo a que el backend procese el evento
    setTimeout(() => setRefreshTrigger((n) => n + 1), 500);
  };

  const handleSSEEvent = (event) => {
    if (event.evento === 'ProcesoCompletado') {
      setRefreshTrigger((n) => n + 1);
    }
  };

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <div className="logo">A</div>
          <div>
            <h1 className="title">Controlador de Tráfico Aéreo</h1>
            <p className="subtitle">Panel de gestion de aterrizajes</p>
          </div>
        </div>
        <SSEStatus onEvent={handleSSEEvent} />
      </header>

      <div className="layout">
        <aside className="sidebar">
          <FlightForm onFlightCreated={handleFlightCreated} />
        </aside>
        <section className="main-content">
          <FlightList refreshTrigger={refreshTrigger} />
        </section>
      </div>
    </main>
  );
}
