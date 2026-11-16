/**
 * CSS Selectors for Grok (grok.com)
 *
 * Selectors are ordered by stability (HIGH → LOW).
 * Measured live on 2026-11-16 (one account, one conversation).
 * @see docs/adr/005-shared-selector-modules.md
 */

import type { SelectorGroup, ComputedSelectors } from './types';

export const SELECTORS = {
  // One virtual row per turn. Grok's transcript is a virtualizer: rows are
  // absolutely positioned inside a fixed-height parent, so a long conversation
  // only mounts a window of turns. The value is `gateway:<response uuid>`,
  // stable per turn — used as the accumulation key. Spacer rows carry
  // `transcript:*` values and are skipped by requiring a message inside.
  conversationRow: [
    '[data-plane-row^="gateway:"]', // Virtual row keyed by response id (HIGH)
  ],

  // The user's bubble. Holds an sr-only "You" heading, the text, and the
  // edit/copy actions — the latter two are stripped before conversion.
  userMessage: [
    '[data-testid="user-message"]', // Test id (HIGH)
    '[data-user-message-row] .message-bubble', // Row marker + bubble (MEDIUM)
  ],

  // The assistant's bubble. Also wraps the "Thought for N s" trace, which is
  // never exported; only markdownContent inside it is read.
  assistantResponse: [
    '[data-testid="assistant-message"]', // Test id (HIGH)
  ],

  markdownContent: [
    '.response-content-markdown', // Semantic (HIGH)
  ],

  scrollContainer: [
    '[data-testid="chat-transcript-scroller"]', // Test id (HIGH)
  ],
} as const satisfies SelectorGroup;

export const JOINED_SELECTORS = {
  // For `closest()`: "is this element inside an assistant response?"
  assistantResponse: SELECTORS.assistantResponse.join(', '),
} as const satisfies ComputedSelectors;
