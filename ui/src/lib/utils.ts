import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { EmulatorInfo } from "./types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * `table[key]` when `key` is one of the table's own keys, else undefined. For
 * values from the backend, which a newer StackPort may extend past what this UI
 * has copy for.
 */
export function lookup<V>(table: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

/** Whether `url` is an https:// URL, the only kind where certificates come into it for an emulator. */
export function isHttpsUrl(url: string | null): boolean {
  return url !== null && url.trim().toLowerCase().startsWith('https://')
}

/** The emulator's name, with its version when it reports one. */
export function emulatorLabel(emulator: EmulatorInfo): string {
  return emulator.version ? `${emulator.name} ${emulator.version}` : emulator.name
}
