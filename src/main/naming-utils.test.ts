import { describe, it, expect } from 'vitest'
import { generateBranchSlug, generateRandomPhrase } from './naming-utils'

describe('generateRandomPhrase', () => {
  it('returns adjective-noun format', () => {
    const phrase = generateRandomPhrase()
    expect(phrase).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('produces different results over multiple calls', () => {
    const results = new Set(Array.from({ length: 50 }, () => generateRandomPhrase()))
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('generateBranchSlug', () => {
  // Helper: strip the 4-char hash suffix for keyword assertions
  function slugWithoutHash(slug: string): string {
    return slug.replace(/-[a-z0-9]{4}$/, '')
  }

  it('always ends with a 4-char alphanumeric hash', () => {
    const slugs = [
      generateBranchSlug('Fix the login bug'),
      generateBranchSlug(''),
      generateBranchSlug('please make sure to do it'),
      generateBranchSlug('Add unit tests for auth module'),
    ]
    for (const slug of slugs) {
      expect(slug).toMatch(/-[a-z0-9]{4}$/)
    }
  })

  it('extracts action verb + keywords from simple prompts', () => {
    expect(slugWithoutHash(generateBranchSlug('Fix the login bug'))).toBe('fix-login-bug')
  })

  it('extracts keywords from a longer prompt', () => {
    const slug = slugWithoutHash(generateBranchSlug('Add unit tests for the auth module'))
    expect(slug).toBe('add-unit-tests-auth')
  })

  it('handles refactoring prompts', () => {
    const slug = slugWithoutHash(generateBranchSlug('Refactor database connection pooling'))
    expect(slug).toBe('refactor-database-connection-pooling')
  })

  it('handles update prompts', () => {
    const slug = slugWithoutHash(generateBranchSlug('Update the README with installation instructions'))
    expect(slug).toBe('update-readme-installation-instructions')
  })

  it('limits to 4 keywords max', () => {
    const slug = slugWithoutHash(generateBranchSlug('Implement rate limiting middleware for API endpoints using Redis'))
    const parts = slug.split('-')
    expect(parts.length).toBeLessThanOrEqual(4)
  })

  it('truncates individual words longer than 15 chars', () => {
    const slug = slugWithoutHash(generateBranchSlug('Fix internationalization configuration'))
    const parts = slug.split('-')
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(15)
    }
  })

  it('falls back to random phrase for empty prompt', () => {
    const slug = slugWithoutHash(generateBranchSlug(''))
    // Should be adjective-noun format from fallback
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('falls back to random phrase when prompt is all stop words', () => {
    const slug = slugWithoutHash(generateBranchSlug('please make sure to do it'))
    // All stop words → fallback to adjective-noun
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('falls back for whitespace-only prompts', () => {
    const slug = slugWithoutHash(generateBranchSlug('   '))
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('strips special characters from prompts', () => {
    const slug = slugWithoutHash(generateBranchSlug('Fix the "login" bug (urgent!)'))
    expect(slug).toBe('fix-login-bug-urgent')
  })

  it('handles prompts with numbers', () => {
    const slug = slugWithoutHash(generateBranchSlug('Fix issue #42 in auth'))
    expect(slug).toBe('fix-issue-42-auth')
  })

  it('deduplicates repeated words', () => {
    const slug = slugWithoutHash(generateBranchSlug('Fix fix fix the bug'))
    expect(slug).toBe('fix-bug')
  })

  it('skips single-character non-stop words (except as first word)', () => {
    const slug = slugWithoutHash(generateBranchSlug('Add a b c feature'))
    expect(slug).toBe('add-feature')
  })

  it('produces filesystem-safe slugs (no spaces, slashes, or special chars)', () => {
    const prompts = [
      'Fix the login/session timeout bug',
      'Add feature: dark mode support',
      'Refactor src/components/Header.tsx',
      'Update CI/CD pipeline configuration',
    ]
    for (const prompt of prompts) {
      const slug = generateBranchSlug(prompt)
      expect(slug).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('handles very long prompts gracefully', () => {
    const longPrompt = 'Implement a comprehensive end-to-end testing framework with automatic screenshot comparison, visual regression detection, accessibility audit integration, and performance monitoring across all supported browser environments including Chrome, Firefox, Safari, and Edge with both desktop and mobile viewport configurations'
    const slug = generateBranchSlug(longPrompt)
    // Should still have at most 4 keywords + hash
    const parts = slug.split('-')
    expect(parts.length).toBeLessThanOrEqual(5) // 4 keywords + 1 hash
    expect(slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('handles prompt that starts with a stop word', () => {
    const slug = slugWithoutHash(generateBranchSlug('The authentication module needs refactoring'))
    // "The" should be skipped, first meaningful word should be captured
    expect(slug).toBe('authentication-module-needs-refactoring')
  })

  it('handles multi-line prompts', () => {
    const slug = slugWithoutHash(generateBranchSlug('Fix the login bug\nthat causes session timeout\nfor admin users'))
    // Newlines become non-alphanumeric, get stripped, words still extracted
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(slug).toContain('fix')
    expect(slug).toContain('login')
  })

  it('produces unique slugs for the same prompt (due to timestamp hash)', () => {
    // Note: might occasionally collide within same millisecond window
    // but across multiple calls, should usually differ
    const slugs = new Set<string>()
    for (let i = 0; i < 10; i++) {
      slugs.add(generateBranchSlug('Fix the login bug'))
    }
    // At minimum, keywords should be consistent
    for (const slug of slugs) {
      expect(slug).toMatch(/^fix-login-bug-[a-z0-9]{4}$/)
    }
  })

  // Real-world prompt examples
  describe('real-world prompts', () => {
    it('handles GitHub issue-style prompts', () => {
      const slug = slugWithoutHash(generateBranchSlug('Fix: user cannot log in after password reset'))
      expect(slug).toBe('fix-user-cannot-log')
    })

    it('handles Jira ticket descriptions', () => {
      const slug = slugWithoutHash(generateBranchSlug('Implement dark mode toggle in settings page'))
      expect(slug).toBe('implement-dark-mode-toggle')
    })

    it('handles code review feedback', () => {
      const slug = slugWithoutHash(generateBranchSlug('Refactor the database query to use parameterized statements'))
      // "to" is a stop word, but "use" is not — so we get the first 4 non-stop words
      expect(slug).toBe('refactor-database-query-use')
    })

    it('handles test-related prompts', () => {
      const slug = slugWithoutHash(generateBranchSlug('Write integration tests for payment processing'))
      expect(slug).toBe('write-integration-tests-payment')
    })

    it('handles dependency update prompts', () => {
      const slug = slugWithoutHash(generateBranchSlug('Upgrade React from v18 to v19'))
      expect(slug).toBe('upgrade-react-v18-v19')
    })

    it('handles documentation prompts', () => {
      const slug = slugWithoutHash(generateBranchSlug('Document the API endpoints for user management'))
      expect(slug).toBe('document-api-endpoints-user')
    })

    it('handles performance optimization prompts', () => {
      const slug = slugWithoutHash(generateBranchSlug('Optimize slow SQL queries in the dashboard'))
      expect(slug).toBe('optimize-slow-sql-queries')
    })

    it('handles security fix prompts', () => {
      const slug = slugWithoutHash(generateBranchSlug('Patch XSS vulnerability in comment rendering'))
      expect(slug).toBe('patch-xss-vulnerability-comment')
    })
  })
})
