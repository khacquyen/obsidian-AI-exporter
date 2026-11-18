/**
 * ChatGPT Deep Research / app-frame reports read through the frame agent (ADR-046).
 *
 * Fixture follows the structure measured live on 2026-11-18: the report iframe
 * sits under `div[data-mcp-app-frame]` inside the answer unit of the turn, its
 * host is `connector-id-<hash>.web-sandbox.oaiusercontent.com` and its title is
 * localized. Conversation text is invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChatGPTExtractor,
  requestFrameReports,
  type FrameReports,
} from '../../src/content/extractors/chatgpt';
import { FRAME_REPORT_REPLY, FRAME_REPORT_REQUEST } from '../../src/lib/chatgpt-frame-protocol';
import {
  loadFixture,
  clearFixture,
  resetLocation,
  setChatGPTLocation,
} from '../fixtures/dom-helpers';
import { createChatGPT2026Page, type PairTurn } from '../fixtures/chatgpt-2026-09-dom';

const SANDBOX_ORIGIN =
  'https://connector-id-dfbccc248e43b6fe7d187129e21b5ec8.web-sandbox.oaiusercontent.com';

function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

/** Mount one turn and put an app frame inside its answer unit (or after the prompt). */
function mountReportTurn(turn: PairTurn): HTMLIFrameElement {
  loadFixture(createChatGPT2026Page([turn]));
  const host =
    document.querySelectorAll('[data-chatgpt-search-message-ids]')[1] ??
    document.querySelector('[data-content-search-turn-key]')!;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<div data-mcp-app-portal-target="true"><div data-mcp-app-frame="true">
      <iframe title="Nghiên cứu sâu" src="${SANDBOX_ORIGIN}/?app=chatgpt&locale=vi-VN"
              sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
    </div></div>`;
  host.appendChild(wrapper);
  return wrapper.querySelector('iframe')!;
}

const REPORT = '<h1>Báo cáo truy cập</h1><p>Sáu lĩnh vực trong index.</p>';

describe('ChatGPT app-frame reports (ADR-046)', () => {
  let extractor: ChatGPTExtractor;

  beforeEach(() => {
    extractor = new ChatGPTExtractor();
    clearFixture();
    setChatGPTLocation('6afdb19f-8fb4-83ec-9a07-07aebb0699db');
  });

  afterEach(() => {
    clearFixture();
    resetLocation();
  });

  describe('extract', () => {
    it('adds the report as its own message after the answer, under the frame title', async () => {
      const frame = mountReportTurn({
        key: 'u-1',
        user: 'Liệt kê lĩnh vực',
        answers: ['<p>Đã khởi chạy Deep Research.</p>'],
      });
      extractor.frameReportReader = async () => new Map([[frame, REPORT]]);

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      const messages = result.data!.messages;
      expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'assistant']);
      expect(plainText(messages[1].content)).toBe('Đã khởi chạy Deep Research.');
      const report = plainText(messages[2].content);
      expect(report).toContain('Nghiên cứu sâu');
      expect(report).toContain('Sáu lĩnh vực trong index.');
      expect(messages[2].id).toBe('u-1:app-frame-0');
      expect(result.warnings?.join(' ') ?? '').not.toMatch(/deep research/i);
    });

    it('raises the message count once the report becomes readable (append mode adds by count)', async () => {
      // First sync: report not yet readable. Second sync: readable. Append mode
      // only adds messages beyond the saved count, so the report must count.
      const frame = mountReportTurn({
        key: 'u-1',
        user: 'Liệt kê lĩnh vực',
        answers: ['<p>Đã khởi chạy Deep Research.</p>'],
      });
      extractor.frameReportReader = async (): Promise<FrameReports> => new Map();
      const first = await extractor.extract();
      extractor.frameReportReader = async () => new Map([[frame, REPORT]]);
      const second = await extractor.extract();

      expect(second.data!.messages.length).toBe(first.data!.messages.length + 1);
      expect(second.data!.messages.slice(0, 2)).toEqual(first.data!.messages);
    });

    it('detects the 2026-11 frame and warns when its report cannot be read', async () => {
      // Before ADR-046 this frame matched no selector: the report vanished silently.
      mountReportTurn({
        key: 'u-1',
        user: 'Liệt kê lĩnh vực',
        answers: ['<p>Đã khởi chạy Deep Research.</p>'],
      });
      extractor.frameReportReader = async (): Promise<FrameReports> => new Map();

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      expect(result.warnings?.join(' ')).toMatch(/deep research/i);
    });

    it('saves a report-only turn instead of refusing it', async () => {
      const frame = mountReportTurn({ key: 'u-1', user: 'Liệt kê lĩnh vực' });
      extractor.frameReportReader = async () => new Map([[frame, REPORT]]);

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      expect(result.data!.messages.map(m => m.role)).toEqual(['user', 'assistant']);
      expect(plainText(result.data!.messages[1].content)).toContain('Sáu lĩnh vực trong index.');
    });

    it('sanitizes report HTML from the frame', async () => {
      const frame = mountReportTurn({ key: 'u-1', user: 'q', answers: ['<p>a</p>'] });
      extractor.frameReportReader = async () =>
        new Map([[frame, '<p>ok</p><img src=x onerror="alert(1)"><script>alert(2)</script>']]);

      const result = await extractor.extract();

      const answer = result.data!.messages.find(m => m.role === 'assistant')!.content;
      expect(answer).not.toMatch(/onerror|<script/);
    });
  });

  describe('requestFrameReports', () => {
    function replyTo(
      frame: HTMLIFrameElement,
      shape: (nonce: string) => MessageEventInit
    ): ReturnType<typeof vi.spyOn> {
      return vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((
        message: { type: string; nonce: string },
        targetOrigin: string
      ) => {
        expect(message.type).toBe(FRAME_REPORT_REQUEST);
        expect(targetOrigin).toBe(SANDBOX_ORIGIN);
        window.dispatchEvent(new MessageEvent('message', shape(message.nonce)));
      }) as never);
    }

    it('collects the report a frame sends back', async () => {
      const frame = mountReportTurn({ key: 'u-1', user: 'q' });
      replyTo(frame, nonce => ({
        origin: SANDBOX_ORIGIN,
        source: frame.contentWindow,
        data: { type: FRAME_REPORT_REPLY, nonce, html: REPORT, nestedFrames: 0 },
      }));

      const reports = await requestFrameReports([frame], 200);

      expect(reports.get(frame)).toBe(REPORT);
    });

    it.each([
      ['another origin', { origin: 'https://evil.example' }],
      ['a stale nonce', { nonce: 'not-the-one' }],
      ['a source that is not the frame', { source: window }],
    ])('ignores a reply from %s', async (_label, override) => {
      const frame = mountReportTurn({ key: 'u-1', user: 'q' });
      replyTo(frame, nonce => ({
        origin: override.origin ?? SANDBOX_ORIGIN,
        source: 'source' in override ? override.source : frame.contentWindow,
        data: {
          type: FRAME_REPORT_REPLY,
          nonce: override.nonce ?? nonce,
          html: REPORT,
          nestedFrames: 0,
        },
      }));

      const reports = await requestFrameReports([frame], 30);

      expect(reports.size).toBe(0);
    });

    it('resolves empty without waiting when there are no frames', async () => {
      const started = Date.now();
      const reports = await requestFrameReports([], 5000);
      expect(reports.size).toBe(0);
      expect(Date.now() - started).toBeLessThan(100);
    });
  });
});
