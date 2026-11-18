import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleFrameMessage } from '../../src/content/chatgpt-frame-agent';
import {
  CHATGPT_ORIGIN,
  FRAME_REPORT_REPLY,
  FRAME_REPORT_REQUEST,
} from '../../src/lib/chatgpt-frame-protocol';

const SANDBOX = 'https://connector-id-abc.web-sandbox.oaiusercontent.com';

function request(overrides: Partial<MessageEventInit> = {}): MessageEvent {
  return new MessageEvent('message', {
    origin: CHATGPT_ORIGIN,
    source: window.parent,
    data: { type: FRAME_REPORT_REQUEST, nonce: 'abc' },
    ...overrides,
  });
}

describe('chatgpt-frame-agent (ADR-046)', () => {
  let post: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML =
      '<button>Tải xuống</button><article><h1>Báo cáo</h1><p>Sáu lĩnh vực.</p></article>';
    post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  });

  afterEach(() => {
    post.mockRestore();
    document.body.innerHTML = '';
  });

  function lastReply(): [Record<string, unknown>, string] {
    return post.mock.calls.at(-1) as [Record<string, unknown>, string];
  }

  it('answers chatgpt.com with the report HTML, to that origin only', async () => {
    await handleFrameMessage(request());

    expect(post).toHaveBeenCalledTimes(1);
    const [reply, targetOrigin] = lastReply();
    expect(targetOrigin).toBe(CHATGPT_ORIGIN);
    expect(reply.type).toBe(FRAME_REPORT_REPLY);
    expect(reply.nonce).toBe('abc');
    expect(reply.html).toContain('Sáu lĩnh vực.');
    expect(reply.html).not.toContain('Tải xuống');
    expect(reply.nestedFrames).toBe(0);
  });

  it('reads a same-origin nested frame when its own document has no text', async () => {
    // Live 2026-11-18: the app frame held no text and exactly one nested iframe.
    document.body.innerHTML = '<button>Tải xuống</button><iframe></iframe>';
    const nested = document.querySelector('iframe')!;
    nested.contentDocument!.body.innerHTML = '<main><h2>Tóm tắt</h2><p>Sáu lĩnh vực.</p></main>';

    await handleFrameMessage(request());

    const [reply] = lastReply();
    expect(reply.html).toContain('Sáu lĩnh vực.');
    expect(reply.nestedFrames).toBe(1);
  });

  it('answers an app sandbox parent (it is the nested frame), replying to that origin', async () => {
    await handleFrameMessage(request({ origin: SANDBOX }));

    const [reply, targetOrigin] = lastReply();
    expect(targetOrigin).toBe(SANDBOX);
    expect(reply.html).toContain('Sáu lĩnh vực.');
  });

  it('replies empty, not hanging, when nothing can be read', async () => {
    document.body.innerHTML = '<button>Loading</button>';
    await handleFrameMessage(request());
    expect(lastReply()[0].html).toBe('');
  });

  it('ignores a request from any other origin', async () => {
    await handleFrameMessage(request({ origin: 'https://evil.example' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('ignores a message that is not a report request', async () => {
    await handleFrameMessage(request({ data: { type: 'something-else', nonce: 'abc' } }));
    await handleFrameMessage(request({ data: 'hello' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('ignores a sender other than its direct parent', async () => {
    const other = document.createElement('iframe');
    document.body.appendChild(other);
    await handleFrameMessage(request({ source: other.contentWindow }));
    expect(post).not.toHaveBeenCalled();
  });
});
