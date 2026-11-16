// Grok DOM health check — run in the page context of an open grok.com/c/<uuid>
// conversation (DevTools console, or Claude in Chrome javascript_tool).
// Mirrors src/content/extractors/selectors/grok.ts; keep the two in sync.
// Result: { ok, broken: [...names], counts: {...} }. ok=false means a selector
// the extractor depends on matched nothing and the extractor needs repair.
(() => {
  const SELECTORS = {
    conversationRow: ['[data-plane-row^="gateway:"]'],
    userMessage: ['[data-testid="user-message"]', '[data-user-message-row] .message-bubble'],
    assistantResponse: ['[data-testid="assistant-message"]'],
    markdownContent: ['.response-content-markdown'],
    scrollContainer: ['[data-testid="chat-transcript-scroller"]'],
  };
  // Stripped as page chrome; a zero here means the export may now include
  // the role heading or the thinking trace. Advisory, not fatal.
  const CHROME = {
    roleHeading: '[data-testid="user-message"] h2.sr-only',
    userActions: '[data-testid="user-message-actions"]',
  };
  const counts = {};
  const broken = [];
  for (const [name, list] of Object.entries(SELECTORS)) {
    counts[name] = list.map(s => document.querySelectorAll(s).length);
    if (counts[name][0] === 0) broken.push(name);
  }
  for (const [name, sel] of Object.entries(CHROME)) {
    counts[name] = document.querySelectorAll(sel).length;
    if (counts[name] === 0) broken.push(`${name} (advisory)`);
  }
  const onConversation = /^\/c\/[a-f0-9-]{36}/i.test(location.pathname);
  return { ok: onConversation && broken.filter(b => !b.includes('advisory')).length === 0, onConversation, title: document.title, broken, counts };
})();
