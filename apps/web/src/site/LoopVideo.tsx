import { useEffect, useRef } from 'react';

// A muted clip that loops while it's on screen and pauses when it isn't, so a page of them doesn't play them all at
// once. Nothing loads until it's near the screen; the poster shows until then, and stays when motion is reduced.
export function LoopVideo({ src, poster, className }: { src: string; poster: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    video.muted = true; // React doesn't write `muted` into prerendered HTML, and browsers only autoplay muted video
    const seen = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }, { rootMargin: '200px' });
    seen.observe(video);
    return () => seen.disconnect();
  }, []);
  return <video ref={ref} className={className} src={src} poster={poster} muted loop playsInline preload="none" aria-hidden="true" />;
}
