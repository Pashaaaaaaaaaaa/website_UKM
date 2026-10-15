'use client';

import { useEffect } from 'react';

function installReferenceReveals(root: ParentNode = document) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<Element, Animation>();
  const elements = [...root.querySelectorAll('[data-reveal]')];
  const finish = (element: Element) => {
    (element as HTMLElement).dataset.revealPlayed = 'true';
    animations.get(element)?.cancel();
    animations.delete(element);
  };
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        observer?.unobserve(element);
        element.dataset.revealPlayed = 'true';
        if (reduced.matches || document.visibilityState === 'hidden' || entry.boundingClientRect.bottom <= 0) {
          finish(element);
        } else animations.get(element)?.play();
      }
    }, { threshold: 0, rootMargin: '0px 0px 96px 0px' })
    : undefined;
  const stop = () => { observer?.disconnect(); elements.forEach(finish); };
  const onPreference = () => { if (reduced.matches) stop(); };
  reduced.addEventListener('change', onPreference);

  for (const element of elements) {
    const node = element as HTMLElement;
    if (node.dataset.revealPlayed === 'true') continue;
    const rect = node.getBoundingClientRect();
    if (reduced.matches || !observer || !node.animate || rect.top < innerHeight || document.visibilityState === 'hidden') {
      finish(node);
      continue;
    }
    const transform = node.dataset.reveal === 'media' ? 'scale(1.025)' : node.dataset.reveal === 'slide' ? 'translateX(-12px)' : 'translateY(12px)';
    const animation = node.animate([{ opacity: 0, transform }, { opacity: 1, transform: 'none' }], {
      duration: 600,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'backwards',
    });
    animation.pause();
    animation.onfinish = () => finish(node);
    animations.set(node, animation);
    observer.observe(node);
  }
  return () => { stop(); reduced.removeEventListener('change', onPreference); };
}

export function ReferenceMotion() {
  useEffect(() => installReferenceReveals(document), []);
  return null;
}
