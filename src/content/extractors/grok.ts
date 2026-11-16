/**
 * Grok Extractor
 *
 * Extracts conversations from Grok (grok.com). Normal chat only: the thinking
 * trace, sources panel and generated images are not exported.
 */

import { BaseExtractor, type ScrollConfig } from './base';
import { sanitizeHtml } from '../../lib/sanitize';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../lib/constants';
import { userHtmlToMarkdown } from '../markdown-rules';
import { generateHash } from '../../lib/hash';
import type { HarvestEntry } from '../../lib/scroll-accumulate';
import type { ConversationMessage } from '../../lib/types';
import { SELECTORS, JOINED_SELECTORS } from './selectors/grok';

/**
 * Page chrome inside a bubble: the screen-reader role heading ("You" /
 * "Grok", localized), the user message actions, and the thinking trace.
 * Only stripped, never extracted, so they stay out of SELECTORS (#402).
 */
const BUBBLE_CHROME_SELECTOR =
  'h2.sr-only, [data-testid="user-message-actions"], [data-testid="conversation-trace-slot"]';

type Turn = { element: Element; type: 'user' | 'assistant' };

export class GrokExtractor extends BaseExtractor {
  readonly platform = 'grok';

  /**
   * URL format: https://grok.com/c/{uuid}[?rid=...]
   */
  getConversationId(): string | null {
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
  }

  /** document.title is "<title> - Grok"; the suffix is stripped by the base. */
  getTitle(): string {
    const pageTitle = this.getPageTitle();
    if (pageTitle) return pageTitle;
    // Not getFirstMessageTitle(): the bubble's textContent includes the
    // sr-only role heading and the action buttons.
    const first = this.queryWithFallback<HTMLElement>(SELECTORS.userMessage);
    const text = first ? this.extractPlainText(this.stripChrome(first)) : '';
    return text ? text.substring(0, MAX_CONVERSATION_TITLE_LENGTH) : 'Untitled Grok Conversation';
  }

  extractMessages(): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    this.collectSortedElements().forEach((item, index) => {
      const turn = this.extractTurn(item);
      if (turn.content) {
        messages.push({
          id: `${item.type}-${index}`,
          role: item.type,
          ...turn,
          index: messages.length,
        });
      }
    });
    return messages;
  }

  private collectSortedElements(): Turn[] {
    const all: Turn[] = [];
    this.queryAllWithFallback<HTMLElement>(SELECTORS.userMessage).forEach(el => {
      if (!el.closest(JOINED_SELECTORS.assistantResponse)) all.push({ element: el, type: 'user' });
    });
    this.queryAllWithFallback<HTMLElement>(SELECTORS.assistantResponse).forEach(el => {
      all.push({ element: el, type: 'assistant' });
    });
    return this.sortByDomPosition(all);
  }

  /** Grok virtualizes the transcript (measured live 2026-11-16). */
  protected getScrollConfig(): ScrollConfig {
    return {
      container: SELECTORS.scrollContainer,
      harvest: () => this.harvestWindow(),
    };
  }

  /**
   * Key each turn by its virtual row (`gateway:<response uuid>`). No `order`
   * is supplied: the row's translateY is an estimated layout offset, not a
   * stable ordinal, so the merge order of overlapping windows stands.
   */
  private harvestWindow(): HarvestEntry<ConversationMessage>[] {
    const entries: HarvestEntry<ConversationMessage>[] = [];
    this.collectSortedElements().forEach(item => {
      const turn = this.extractTurn(item);
      if (!turn.content) return;
      const rowId = item.element
        .closest(SELECTORS.conversationRow[0])
        ?.getAttribute('data-plane-row');
      const key = rowId ? `${item.type}-${rowId}` : `${item.type}-${generateHash(turn.content)}`;
      entries.push({ key, value: { id: key, role: item.type, ...turn, index: 0 } });
    });
    return entries;
  }

  private extractTurn(
    item: Turn
  ): Pick<ConversationMessage, 'content' | 'contentFormat' | 'htmlContent'> {
    if (item.type === 'user') return this.extractUserContent(item.element);
    const content = this.extractAssistantContent(item.element);
    return { content, htmlContent: content };
  }

  private stripChrome(element: Element): Element {
    const clone = element.cloneNode(true) as Element;
    clone.querySelectorAll(BUBBLE_CHROME_SELECTOR).forEach(node => node.remove());
    return clone;
  }

  private extractUserContent(
    element: Element
  ): Pick<ConversationMessage, 'content' | 'contentFormat'> {
    const clean = this.stripChrome(element);
    const markdown = userHtmlToMarkdown(sanitizeHtml(clean.innerHTML)).trim();
    if (markdown) return { content: markdown, contentFormat: 'markdown' };
    const text = clean.textContent?.trim();
    return { content: text ? this.sanitizeText(text) : '', contentFormat: 'text' };
  }

  private extractAssistantContent(element: Element): string {
    const sections = this.queryAllWithFallback<HTMLElement>(SELECTORS.markdownContent, element);
    const parts = sections.map(s => sanitizeHtml(s.innerHTML)).filter(html => html.trim());
    if (parts.length > 0) return parts.join('\n');
    return sanitizeHtml(this.stripChrome(element).innerHTML);
  }
}
