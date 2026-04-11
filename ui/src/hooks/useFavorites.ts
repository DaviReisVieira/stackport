import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'stackport:favorites';

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // Ignore localStorage errors
    }
  }, [favorites]);

  const toggleFavorite = useCallback((service: string) => {
    setFavorites(prev =>
      prev.includes(service)
        ? prev.filter(s => s !== service)
        : [...prev, service]
    );
  }, []);

  const isFavorite = useCallback(
    (service: string) => favorites.includes(service),
    [favorites]
  );

  return { favorites, toggleFavorite, isFavorite };
}
