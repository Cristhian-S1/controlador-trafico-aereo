import "./globals.css";

export const metadata = {
  title: 'ATC — Controlador de Tráfico Aéreo',
  description: 'Panel de control para gestión de aterrizajes, pistas y tasas aeroportuarias'
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
