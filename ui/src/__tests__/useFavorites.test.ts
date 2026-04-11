import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFavorites } from '../hooks/useFavorites';

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('initializes with empty array when no stored data', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);
  });

  it('initializes with stored data from localStorage', () => {
    localStorage.setItem('stackport:favorites', JSON.stringify(['s3', 'lambda']));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual(['s3', 'lambda']);
  });

  it('handles invalid JSON in localStorage gracefully', () => {
    localStorage.setItem('stackport:favorites', 'invalid json');
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);
  });

  it('adds a service to favorites', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('s3');
    });

    expect(result.current.favorites).toEqual(['s3']);
    expect(result.current.isFavorite('s3')).toBe(true);
  });

  it('removes a service from favorites', () => {
    localStorage.setItem('stackport:favorites', JSON.stringify(['s3', 'lambda']));
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('s3');
    });

    expect(result.current.favorites).toEqual(['lambda']);
    expect(result.current.isFavorite('s3')).toBe(false);
  });

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('dynamodb');
    });

    const stored = localStorage.getItem('stackport:favorites');
    expect(stored).toBe('["dynamodb"]');
  });

  it('maintains order when adding multiple favorites', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('s3');
      result.current.toggleFavorite('lambda');
      result.current.toggleFavorite('dynamodb');
    });

    expect(result.current.favorites).toEqual(['s3', 'lambda', 'dynamodb']);
  });

  it('isFavorite returns false for non-favorite services', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite('s3');
    });

    expect(result.current.isFavorite('s3')).toBe(true);
    expect(result.current.isFavorite('lambda')).toBe(false);
  });
});
