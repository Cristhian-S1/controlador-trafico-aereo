'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

function statusClass(estado) {
  if (estado === 'COMPLETADO') return 'badge badge-completado';
  if (estado === 'ASIGNADA') return 'badge badge-asignada';
  return 'badge badge-pendiente';
}

function rowStatusClass(estado) {
  if (estado === 'COMPLETADO') return 'row-completado';
  if (estado === 'ASIGNADA') return 'row-asignada';
  return 'row-pendiente';
}

export default function FlightList({ refreshTrigger }) {
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadFlights = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vuelos`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFlights(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlights();
  }, [refreshTrigger]);

  if (loading) return <div className="card empty-state">Cargando historial...</div>;
  if (error) return <div className="card empty-state">Error al cargar vuelos: {error}</div>;
  if (flights.length === 0) return <div className="card empty-state">No hay vuelos registrados.</div>;

  return (
    <div className="card">
      <h2>Historial de vuelos</h2>
      <table className="flight-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Vuelo</th>
            <th>Origen → Destino</th>
            <th>Aeronave</th>
            <th>Pasajeros</th>
            <th>Estado</th>
            <th>Solicitud</th>
          </tr>
        </thead>
        <tbody>
          {flights.map((flight) => (
            <tr key={flight.vuelo_id} className={rowStatusClass(flight.estado)}>
              <td>{flight.vuelo_id}</td>
              <td>{flight.aerolinea} {flight.numero_vuelo}</td>
              <td>{flight.origen} → {flight.destino}</td>
              <td>{flight.aeronave}</td>
              <td>{flight.pasajeros}</td>
              <td>
                <span className={statusClass(flight.estado)}>{flight.estado}</span>
              </td>
              <td>{new Date(flight.timestamp_solicitud || flight.timestamp).toLocaleString('es-CL')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
