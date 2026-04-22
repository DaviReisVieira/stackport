import { useState, useEffect, useCallback } from 'react'
import type { SQSFavoriteMessage } from '@/lib/types'

const STORAGE_KEY = 'stackport:sqs-favorite-messages'

function generateId(): string {
  return `fav_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export function useSQSFavoriteMessages() {
  const [favoriteMessages, setFavoriteMessages] = useState<SQSFavoriteMessage[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return []

      const data = JSON.parse(stored) as { messages?: SQSFavoriteMessage[] }
      return data.messages || []
    } catch {
      return []
    }
  })

  // Persist to localStorage whenever favorites change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: favoriteMessages }))
    } catch {
      // Ignore localStorage errors
    }
  }, [favoriteMessages])

  // Add a single favorite message
  const addFavorite = useCallback((data: {
    messageBody: string
    name: string
    delaySeconds?: number
    messageGroupId?: string
    messageDeduplicationId?: string
    messageAttributes?: Record<string, { stringValue: string; dataType: string }>
    sourceQueue?: string
    originalMessageId?: string
    isBatch?: boolean
  }) => {
    const newFavorite: SQSFavoriteMessage = {
      id: generateId(),
      name: data.name,
      messageBody: data.messageBody,
      delaySeconds: data.delaySeconds,
      messageGroupId: data.messageGroupId,
      messageDeduplicationId: data.messageDeduplicationId,
      messageAttributes: data.messageAttributes,
      createdAt: new Date().toISOString(),
      sourceQueue: data.sourceQueue,
      originalMessageId: data.originalMessageId,
      isBatch: data.isBatch,
    }

    setFavoriteMessages(prev => [...prev, newFavorite])
  }, [])

  // Add multiple favorite messages at once
  const addFavorites = useCallback((messages: Array<{
    messageBody: string
    name: string
    delaySeconds?: number
    messageGroupId?: string
    messageDeduplicationId?: string
    messageAttributes?: Record<string, { stringValue: string; dataType: string }>
    sourceQueue?: string
    originalMessageId?: string
    isBatch?: boolean
  }>) => {
    const newFavorites: SQSFavoriteMessage[] = messages.map(data => ({
      id: generateId(),
      name: data.name,
      messageBody: data.messageBody,
      delaySeconds: data.delaySeconds,
      messageGroupId: data.messageGroupId,
      messageDeduplicationId: data.messageDeduplicationId,
      messageAttributes: data.messageAttributes,
      createdAt: new Date().toISOString(),
      sourceQueue: data.sourceQueue,
      originalMessageId: data.originalMessageId,
      isBatch: data.isBatch,
    }))

    setFavoriteMessages(prev => [...prev, ...newFavorites])
  }, [])

  // Remove a favorite by ID
  const removeFavorite = useCallback((id: string) => {
    setFavoriteMessages(prev => prev.filter(fav => fav.id !== id))
  }, [])

  // Update a favorite by ID
  const updateFavorite = useCallback((id: string, updates: Partial<Omit<SQSFavoriteMessage, 'id' | 'createdAt'>>) => {
    setFavoriteMessages(prev =>
      prev.map(fav =>
        fav.id === id ? { ...fav, ...updates } : fav
      )
    )
  }, [])

  // Get a favorite by ID
  const getFavorite = useCallback((id: string): SQSFavoriteMessage | undefined => {
    return favoriteMessages.find(fav => fav.id === id)
  }, [favoriteMessages])

  // Check if a message is favorited (by original message ID)
  const isFavorited = useCallback((messageId: string): boolean => {
    return favoriteMessages.some(fav => fav.originalMessageId === messageId)
  }, [favoriteMessages])

  return {
    favoriteMessages,
    addFavorite,
    addFavorites,
    removeFavorite,
    updateFavorite,
    getFavorite,
    isFavorited,
  }
}
