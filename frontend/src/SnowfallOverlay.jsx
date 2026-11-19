import { useEffect, useRef, useSyncExternalStore } from 'react';

const SNOWFLAKE_COUNT = 80;
const LAYERS = [
  { speed: 0.3, size: [2, 4], opacity: 0.3, parallax: 0.2 },   // Far background
  { speed: 0.6, size: [3, 6], opacity: 0.5, parallax: 0.5 },   // Mid layer
  { speed: 1.0, size: [4, 8], opacity: 0.8, parallax: 1.0 },   // Foreground
];

// How much of a map pan the nearest snowflakes pick up
const PARALLAX_STRENGTH = 0.3;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(callback) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function createSnowflake(canvas, layer) {
  const sizeRange = layer.size;
  return {
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]),
    speed: layer.speed * (0.5 + Math.random() * 0.5),
    opacity: layer.opacity * (0.7 + Math.random() * 0.3),
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.02 + Math.random() * 0.02,
    parallax: layer.parallax,
  };
}

function createSnowflakes(canvas) {
  const flakes = [];
  const flakesPerLayer = Math.floor(SNOWFLAKE_COUNT / LAYERS.length);
  for (const layer of LAYERS) {
    for (let i = 0; i < flakesPerLayer; i++) {
      flakes.push(createSnowflake(canvas, layer));
    }
  }
  return flakes;
}

/**
 * Falling snow over the page. Pass the MapLibre map (once it has loaded) and
 * the snow drifts with it as the map is panned.
 */
export default function SnowfallOverlay({ map }) {
  const canvasRef = useRef(null);
  // Pixels the map has moved since the last animation frame
  const panRef = useRef({ x: 0, y: 0 });
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion);

  // Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let snowflakes = [];
    let frame = null;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (snowflakes.length === 0) {
        snowflakes = createSnowflakes(canvas);
      }
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const pan = panRef.current;

      for (const flake of snowflakes) {
        // Drift with the map, nearer flakes more than distant ones
        flake.x += pan.x * flake.parallax * PARALLAX_STRENGTH;
        flake.y += pan.y * flake.parallax * PARALLAX_STRENGTH;

        // Natural falling motion
        flake.y += flake.speed;
        flake.wobble += flake.wobbleSpeed;
        flake.x += Math.sin(flake.wobble) * 0.5;

        // Wrap around edges
        if (flake.y > canvas.height + flake.size) {
          flake.y = -flake.size;
          flake.x = Math.random() * canvas.width;
        } else if (flake.y < -flake.size) {
          flake.y = canvas.height + flake.size;
        }
        if (flake.x > canvas.width + flake.size) {
          flake.x = -flake.size;
        } else if (flake.x < -flake.size) {
          flake.x = canvas.width + flake.size;
        }

        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
        ctx.fill();
      }

      panRef.current = { x: 0, y: 0 };
      frame = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);

  // Track map panning for the parallax effect
  useEffect(() => {
    if (!map) return;

    let lastCenter = map.getCenter();

    const onMove = () => {
      // Where the previous center now sits on screen, relative to the current one
      const previous = map.project(lastCenter);
      const current = map.project(map.getCenter());
      panRef.current = {
        x: panRef.current.x + (previous.x - current.x),
        y: panRef.current.y + (previous.y - current.y),
      };
      lastCenter = map.getCenter();
    };

    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
    };
  }, [map]);

  if (reducedMotion) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        // Above the map and title bar, below the sidebar and its backdrop
        zIndex: 930,
      }}
    />
  );
}
