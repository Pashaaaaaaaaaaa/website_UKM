'use client';

export function NewsControls({ targetId = 'news-track', label = 'berita' }: { targetId?: string; label?: string }) {
  const scroll = (direction: -1 | 1) => {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const track = document.getElementById(targetId);
    if (track) track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior });
  };

  return <div className="news-controls" role="group" aria-label={`Kontrol geser ${label}`}>
    <button type="button" aria-label={`Geser ${label} ke kiri`} onClick={() => scroll(-1)}>&larr;</button>
    <button type="button" aria-label={`Geser ${label} ke kanan`} onClick={() => scroll(1)}>&rarr;</button>
  </div>;
}
