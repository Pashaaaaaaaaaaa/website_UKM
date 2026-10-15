import type { ReactNode } from 'react';
import './admin.css';
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="id"><body>{children}</body></html>;
}
