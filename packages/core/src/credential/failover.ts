export * as CredentialFailover from "./failover"

export type CredentialState = {
  readonly id: string
  readonly cooldownUntil?: number
}

export type Pool = {
  readonly next: (now?: number) => CredentialState | undefined
  readonly release: (id: string) => void
  readonly penalize: (id: string, retryAfter?: number, now?: number) => void
}

/** Round-robin selection with per-key cooldown and an in-flight reservation set. */
export function makePool(credentials: readonly CredentialState[], clock = () => Date.now()): Pool {
  const entries = credentials.map((credential) => ({ ...credential }))
  const reserved = new Set<string>()
  let cursor = 0

  return {
    next(now = clock()) {
      if (entries.length === 0) return
      for (let offset = 0; offset < entries.length; offset++) {
        const index = (cursor + offset) % entries.length
        const entry = entries[index]
        if (reserved.has(entry.id) || (entry.cooldownUntil !== undefined && entry.cooldownUntil > now)) continue
        cursor = (index + 1) % entries.length
        reserved.add(entry.id)
        return { ...entry }
      }
    },
    release(id) {
      reserved.delete(id)
    },
    penalize(id, retryAfter = 0, now = clock()) {
      const entry = entries.find((candidate) => candidate.id === id)
      if (!entry) return
      entry.cooldownUntil = now + Math.max(0, retryAfter)
      reserved.delete(id)
    },
  }
}

export function retryAfterMs(value: string | undefined, now = Date.now()) {
  if (!value) return undefined
  const seconds = Number.parseFloat(value)
  if (!Number.isNaN(seconds)) return Math.max(0, Math.ceil(seconds * 1000))
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - now)
}

export function fallbackRoutes(providerID: string): readonly string[] {
  switch (providerID) {
    case "opencode-go":
      return ["zen", "opencode"]
    case "zen":
      return ["opencode-go", "opencode"]
    case "opencode":
      return ["opencode-go", "zen"]
  }
  return []
}

export function otherRoute(providerID: string) {
  return fallbackRoutes(providerID)[0]
}

export function eligible(error: unknown) {
  if (!error || typeof error !== "object") return false
  const data = "data" in error && error.data && typeof error.data === "object" ? error.data : error
  const status = "statusCode" in data && typeof data.statusCode === "number" ? data.statusCode : undefined
  if (status === 401 || status === 402 || status === 403 || status === 429) return true
  const text = JSON.stringify(data).toLowerCase()
  return [
    "rate limit",
    "rate_limit",
    "quota",
    "balance",
    "usage limit",
    "usage_limit",
    "exhausted",
    "authentication",
    "unauthorized",
    "invalid api key",
    "forbidden",
  ].some((term) => text.includes(term))
}

export function matchingModel<T extends { readonly id: string }>(models: readonly T[], id: string, fallback?: T) {
  return models.find((model) => model.id === id) ?? fallback
}
