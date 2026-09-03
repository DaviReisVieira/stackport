import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'stackport:favorites';
const CHANGE_EVENT = 'stackport:favorites-changed';

function readFavorites(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  // Keep every hook instance in sync (e.g. the dashboard star and the top-nav pins)
  useEffect(() => {
    const onChange = () => setFavorites(readFavorites());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const toggleFavorite = useCallback((service: string) => {
    const current = readFavorites();
    const next = current.includes(service)
      ? current.filter(s => s !== service)
      : [...current, service];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore localStorage errors
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const isFavorite = useCallback(
    (service: string) => favorites.includes(service),
    [favorites]
  );

  return { favorites, toggleFavorite, isFavorite };
}
