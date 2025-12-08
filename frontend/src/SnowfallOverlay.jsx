import { useEffect, useRef, useCallback } from 'react';

const SNOWFLAKE_COUNT = 80;
const LAYERS = [
  { speed: 0.3, size: [2, 4], opacity: 0.3, parallax: 0.2 },   // Far background
  { speed: 0.6, size: [3, 6], opacity: 0.5, parallax: 0.5 },   // Mid layer
  { speed: 1.0, size: [4, 8], opacity: 0.8, parallax: 1.0 },   // Foreground
];


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

export default function SnowfallOverlay({ mapRef }) {
  const canvasRef = useRef(null);
  const snowflakesRef = useRef([]);
  const animationRef = useRef(null);
  const lastPanRef = useRef({ x: 0, y: 0 });

  const initSnowflakes = useCallback((canvas) => {
    const flakes = [];
    const flakesPerLayer = Math.floor(SNOWFLAKE_COUNT / LAYERS.length);

    for (const layer of LAYERS) {
      for (let i = 0; i < flakesPerLayer; i++) {
        flakes.push(createSnowflake(canvas, layer));
      }
    }
    return flakes;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (snowflakesRef.current.length === 0) {
        snowflakesRef.current = initSnowflakes(canvas);
      }
    };

    resize();
    window.addEventListener('resize', resize);

    // Track map movement for parallax
    let panOffset = { x: 0, y: 0 };

    if (mapRef?.current) {
      const map = mapRef.current;

      const onMove = () => {
        const center = map.getCenter();
        const zoom = map.getZoom();

        // Convert movement to pixel offset (simplified)
        const newX = center.lng * zoom * 100;
        const newY = center.lat * zoom * 100;

        panOffset = {
          x: newX - lastPanRef.current.x,
          y: -(newY - lastPanRef.current.y), // Invert Y for screen coords
        };

        lastPanRef.current = { x: newX, y: newY };
      };

      map.on('move', onMove);

      return () => {
        map.off('move', onMove);
      };
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const flake of snowflakesRef.current) {
        // Apply parallax offset based on layer depth
        flake.x -= panOffset.x * flake.parallax * 0.1;
        flake.y -= panOffset.y * flake.parallax * 0.1;

        // Natural falling motion
        flake.y += flake.speed;
        flake.wobble += flake.wobbleSpeed;
        flake.x += Math.sin(flake.wobble) * 0.5;

        // Wrap around edges
        if (flake.y > canvas.height + flake.size) {
          flake.y = -flake.size;
          flake.x = Math.random() * canvas.width;
        }
        if (flake.x > canvas.width + flake.size) {
          flake.x = -flake.size;
        }
        if (flake.x < -flake.size) {
          flake.x = canvas.width + flake.size;
        }

        // Draw snowflake
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
        ctx.fill();
      }

      // Reset pan offset after applying
      panOffset = { x: 0, y: 0 };

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [mapRef, initSnowflakes]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    />
  );
}
