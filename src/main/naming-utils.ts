/**
 * Naming utilities for branch names and display names.
 *
 * Provides prompt-aware branch slug generation (keyword extraction + short hash)
 * and random phrase generation (adjective-noun pairs) as a fallback.
 */

// Common English words that don't carry meaningful intent for branch names
const STOP_WORDS = new Set([
  // Articles & determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'some', 'any', 'all', 'each', 'every',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'about', 'into', 'through',
  'between', 'after', 'before', 'above', 'below', 'up', 'down', 'out', 'over',
  // Conjunctions
  'and', 'or', 'but', 'so', 'if', 'then', 'because', 'while', 'when', 'where',
  // Pronouns
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'it', 'its', 'they', 'them', 'their',
  // Auxiliary / modal verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'shall', 'must',
  // Filler / vague words
  'please', 'make', 'sure', 'need', 'want', 'like', 'just', 'also', 'very', 'really',
  'get', 'got', 'thing', 'things', 'way', 'there', 'here', 'not', 'no', 'yes',
])

// Word lists for fun random names
const ADJECTIVES = [
  'fluffy', 'happy', 'brave', 'swift', 'clever', 'gentle', 'mighty', 'calm',
  'wild', 'eager', 'jolly', 'lucky', 'plucky', 'zesty', 'snappy', 'peppy',
]

const NOUNS = [
  'bunny', 'panda', 'koala', 'otter', 'falcon', 'dolphin', 'fox', 'owl',
  'tiger', 'eagle', 'wolf', 'bear', 'hawk', 'lynx', 'raven', 'seal',
]

/**
 * Extract meaningful keywords from a prompt.
 *
 * Keeps the first word if it's not a stop word (usually an action verb like
 * "fix", "add", "refactor"), then collects up to 3 more unique non-stop words.
 * Individual words are truncated at 15 characters.
 */
function extractKeywords(prompt: string): string[] {
  // Normalize: lowercase, strip non-alphanumeric except spaces
  const normalized = prompt.toLowerCase().replace(/[^a-z0-9 ]/g, '')
  const words = normalized.split(/\s+/).filter(w => w.length > 0)

  if (words.length === 0) return []

  const keywords: string[] = []
  const seen = new Set<string>()

  // Keep first word if meaningful (usually the action verb)
  const first = words[0].slice(0, 15)
  if (!STOP_WORDS.has(first)) {
    keywords.push(first)
    seen.add(first)
  }

  // Collect up to 3 more unique non-stop words
  for (let i = 1; i < words.length && keywords.length < 4; i++) {
    const word = words[i].slice(0, 15)
    if (!STOP_WORDS.has(word) && !seen.has(word) && word.length > 1) {
      keywords.push(word)
      seen.add(word)
    }
  }

  return keywords
}

/**
 * Generate a short hash for branch uniqueness.
 * 4 base36 chars derived from current timestamp — cycles every ~60s.
 */
function shortHash(): string {
  return Date.now().toString(36).slice(-4)
}

/**
 * Generate a branch slug from a user prompt.
 *
 * Extracts keywords from the prompt and appends a short hash for uniqueness.
 * Falls back to a random adjective-noun phrase when no meaningful keywords
 * can be extracted (empty/vague prompts).
 *
 * Examples:
 *   "Fix the login session timeout bug" → "fix-login-session-timeout-a3f7"
 *   "please make sure to do it"         → "jolly-panda-m3n8" (fallback)
 *   ""                                  → "brave-falcon-x7k2" (fallback)
 */
export function generateBranchSlug(prompt: string): string {
  const keywords = extractKeywords(prompt)

  if (keywords.length === 0) {
    return `${generateRandomPhrase()}-${shortHash()}`
  }

  return `${keywords.join('-')}-${shortHash()}`
}

/**
 * Generate a fun, memorable random phrase.
 * Format: {adjective}-{noun} (e.g., "plucky-otter")
 *
 * Used for display names and as fallback for branch slugs.
 */
export function generateRandomPhrase(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective}-${noun}`
}
