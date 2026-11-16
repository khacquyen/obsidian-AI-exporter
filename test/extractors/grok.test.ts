import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrokExtractor } from '../../src/content/extractors/grok';
import { loadFixture, clearFixture, resetLocation, defineLocation } from '../fixtures/dom-helpers';

/**
 * DOM shape measured live on grok.com (2026-11-16): virtual rows keyed
 * `gateway:<response uuid>`, bubbles with data-testid, an sr-only role
 * heading, user message actions, and a thinking trace above the answer.
 */
function grokRow(id: string, bubble: string, userRow = false): string {
  return `<div data-plane-row="gateway:${id}"><div id="response-${id}"${
    userRow ? ' data-user-message-row=""' : ''
  }>${bubble}</div></div>`;
}

function userBubble(text: string): string {
  return `<div class="message-bubble" data-testid="user-message">
    <h2 class="sr-only">You</h2>
    <span>${text}</span>
    <div data-testid="user-message-actions"><button data-testid="user-message-action-copy">Copy</button></div>
  </div>`;
}

function assistantBubble(html: string): string {
  return `<div class="message-bubble" data-testid="assistant-message">
    <h2 class="sr-only">Grok</h2>
    <div data-testid="conversation-trace-slot"><div data-testid="conversation-thought">Thought for 21s SECRET-REASONING</div></div>
    <div class="contents"><div><div class="response-content-markdown markdown">${html}</div></div></div>
  </div>`;
}

function grokPage(rows: string[]): string {
  return `<main><div data-testid="chat-transcript-scroller"><div style="position:relative">
    <div data-plane-row="transcript:top-inset" aria-hidden="true"></div>
    ${rows.join('\n')}
    <div data-plane-row="transcript:submit-spacer" aria-hidden="true"></div>
  </div></div></main>`;
}

describe('GrokExtractor', () => {
  let extractor: GrokExtractor;

  beforeEach(() => {
    extractor = new GrokExtractor();
    clearFixture();
  });

  afterEach(() => {
    clearFixture();
    resetLocation();
    document.title = '';
  });

  it('identifies as grok and accepts grok.com', () => {
    defineLocation('grok.com', '/c/46d55f62-fff6-4b87-b30c-56c4e4538600');
    expect(extractor.platform).toBe('grok');
    expect(extractor.canExtract()).toBe(true);
  });

  it('reads the conversation id from /c/<uuid>', () => {
    defineLocation('grok.com', '/c/46d55f62-fff6-4b87-b30c-56c4e4538600');
    expect(extractor.getConversationId()).toBe('46d55f62-fff6-4b87-b30c-56c4e4538600');
  });

  it('returns null id on the home page', () => {
    defineLocation('grok.com', '/');
    expect(extractor.getConversationId()).toBeNull();
  });

  it('strips the " - Grok" title suffix', () => {
    document.title = 'Grok deepsearch là gì - Grok';
    expect(extractor.getTitle()).toBe('Grok deepsearch là gì');
  });

  it('falls back to the first user message for the title', () => {
    document.title = 'Grok';
    loadFixture(grokPage([grokRow('u1', userBubble('Hello there'), true)]));
    expect(extractor.getTitle()).toBe('Hello there');
  });

  it('extracts user and assistant turns in order without page chrome or thinking', () => {
    loadFixture(
      grokPage([
        grokRow('u1', userBubble('grok có thể deepsearch k'), true),
        grokRow('a1', assistantBubble('<p>Có. <strong>DeepSearch</strong></p>')),
        grokRow('u2', userBubble('second question'), true),
        grokRow('a2', assistantBubble('<ul><li>item</li></ul>')),
      ])
    );

    const messages = extractor.extractMessages();
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0].content).toBe('grok có thể deepsearch k');
    expect(messages[0].content).not.toContain('You');
    expect(messages[0].content).not.toContain('Copy');
    expect(messages[1].content).toContain('<strong>DeepSearch</strong>');
    expect(messages[1].content).not.toContain('SECRET-REASONING');
    expect(messages[1].content).not.toContain('Grok');
    expect(messages[3].content).toContain('<li>item</li>');
  });
});
