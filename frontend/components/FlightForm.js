'use client';

import { useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function FlightForm({ onFlightCreated }) {
  const [form, setForm] = useState({
    vuelo_id: '',
    aerolinea: '',
    numero_vuelo: '',
    origen: '',
    destino: '',
    aeronave: '',
    pasajeros: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const payload = {
        ...form,
        pasajeros: parseInt(form.pasajeros, 10) || 0
      };

      const res = await fetch(`${API_BASE}/api/vuelos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setMessage({ type: 'success', text: `Vuelo ${form.vuelo_id} solicitado correctamente.` });
      setForm({
        vuelo_id: '',
        aerolinea: '',
        numero_vuelo: '',
        origen: '',
        destino: '',
        aeronave: '',
        pasajeros: ''
      });
      if (onFlightCreated) onFlightCreated();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Nueva solicitud de aterrizaje</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="vuelo_id">ID de vuelo</label>
            <input id="vuelo_id" name="vuelo_id" value={form.vuelo_id} onChange={handleChange} placeholder="ATC-2025-001" required />
          </div>
          <div className="field">
            <label htmlFor="aerolinea">Aerolinea</label>
            <input id="aerolinea" name="aerolinea" value={form.aerolinea} onChange={handleChange} placeholder="LATAM" required />
          </div>
          <div className="field">
            <label htmlFor="numero_vuelo">Numero de vuelo</label>
            <input id="numero_vuelo" name="numero_vuelo" value={form.numero_vuelo} onChange={handleChange} placeholder="LA1234" required />
          </div>
          <div className="field">
            <label htmlFor="origen">Origen</label>
            <input id="origen" name="origen" value={form.origen} onChange={handleChange} placeholder="SCL" maxLength={10} required />
          </div>
          <div className="field">
            <label htmlFor="destino">Destino</label>
            <input id="destino" name="destino" value={form.destino} onChange={handleChange} placeholder="ARI" maxLength={10} required />
          </div>
          <div className="field">
            <label htmlFor="aeronave">Aeronave</label>
            <input id="aeronave" name="aeronave" value={form.aeronave} onChange={handleChange} placeholder="A320" required />
          </div>
          <div className="field">
            <label htmlFor="pasajeros">Pasajeros</label>
            <input id="pasajeros" name="pasajeros" type="number" min="0" value={form.pasajeros} onChange={handleChange} placeholder="150" required />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Enviando...' : 'Solicitar aterrizaje'}
          </button>
          {message && (
            <span className={`message ${message.type}`}>{message.text}</span>
          )}
        </div>
      </form>
    </div>
  );
}
