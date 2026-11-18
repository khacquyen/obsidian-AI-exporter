import { describe, it, expect } from 'vitest';
import {
  FRAME_REPORT_REPLY,
  FRAME_REPORT_REQUEST,
  cleanReportHtml,
  isFrameReportReply,
  isFrameReportRequest,
  isSandboxOrigin,
  pickReportRoot,
} from '../../src/lib/chatgpt-frame-protocol';

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('chatgpt-frame-protocol (ADR-046)', () => {
  describe('isSandboxOrigin', () => {
    it('accepts the app sandbox host measured live on 2026-11-18', () => {
      expect(
        isSandboxOrigin(
          'https://connector-id-dfbccc248e43b6fe7d187129e21b5ec8.web-sandbox.oaiusercontent.com'
        )
      ).toBe(true);
    });

    it.each([
      'http://connector-id-x.web-sandbox.oaiusercontent.com',
      'https://web-sandbox.oaiusercontent.com',
      'https://x.web-sandbox.oaiusercontent.com.evil.com',
      'https://x.web-sandbox.oaiusercontent.com:8443',
      'https://evil.com',
      'https://chatgpt.com',
      'null',
    ])('rejects %s', origin => {
      expect(isSandboxOrigin(origin)).toBe(false);
    });
  });

  describe('message guards', () => {
    it('recognises a well-formed request and reply', () => {
      expect(isFrameReportRequest({ type: FRAME_REPORT_REQUEST, nonce: 'n' })).toBe(true);
      expect(
        isFrameReportReply({ type: FRAME_REPORT_REPLY, nonce: 'n', html: '', nestedFrames: 0 })
      ).toBe(true);
    });

    it.each([
      null,
      undefined,
      'x',
      {},
      { type: FRAME_REPORT_REQUEST },
      { type: 'other', nonce: 'n' },
    ])('rejects a malformed request %#', data => {
      expect(isFrameReportRequest(data)).toBe(false);
    });

    it('rejects a reply without html or with the wrong type', () => {
      expect(isFrameReportReply({ type: FRAME_REPORT_REPLY, nonce: 'n', nestedFrames: 0 })).toBe(
        false
      );
      expect(
        isFrameReportReply({ type: FRAME_REPORT_REQUEST, nonce: 'n', html: '', nestedFrames: 0 })
      ).toBe(false);
    });
  });

  describe('pickReportRoot / cleanReportHtml', () => {
    it('prefers the article with the most text over app chrome', () => {
      const d = doc(`<body>
        <header><button>Download</button></header>
        <article id="short">Tiny</article>
        <article id="report"><h1>Báo cáo</h1><p>Nội dung dài hơn nhiều.</p></article>
      </body>`);
      expect(pickReportRoot(d)?.id).toBe('report');
    });

    it('falls back to body when there is no article or main', () => {
      const d = doc('<body><div><p>Only text</p></div></body>');
      expect(pickReportRoot(d)).toBe(d.body);
    });

    it('strips scripts and controls but keeps headings, lists and links', () => {
      const d = doc(`<body><main>
        <h2>Tóm tắt</h2><script>alert(1)</script><style>p{}</style>
        <button>Mở rộng</button><svg><path/></svg>
        <ul><li><a href="https://example.com">nguồn</a></li></ul>
      </main></body>`);
      const html = cleanReportHtml(pickReportRoot(d)!);
      expect(html).toContain('<h2>Tóm tắt</h2>');
      expect(html).toContain('href="https://example.com"');
      expect(html).not.toMatch(/script|style|button|svg|Mở rộng/);
    });

    it('returns empty when only controls remain (a frame still loading)', () => {
      const d = doc('<body><button>Loading</button></body>');
      expect(cleanReportHtml(pickReportRoot(d)!)).toBe('');
    });

    it('reads an animated digit counter by its label, not its 0-9 strip', () => {
      // Shape measured live 2026-11-18 in the report header.
      const roller = (label: string): string =>
        `<span aria-label="${label}"><span aria-hidden="true"><span>0</span><span><span>` +
        '<span>0</span><span>1</span><span>2</span><span>3</span><span>9</span>' +
        '</span></span></span></span>';
      const d = doc(
        `<body><div>Đã hoàn tất · ${roller('3 trích dẫn')} · ${roller('0 lượt tìm kiếm')}</div>` +
          '<p>Nội dung</p></body>'
      );
      const text = new DOMParser()
        .parseFromString(cleanReportHtml(pickReportRoot(d)!), 'text/html')
        .body.textContent?.replace(/\s+/g, ' ')
        .trim();
      // textContent joins </div><p> with no space.
      expect(text).toBe('Đã hoàn tất · 3 trích dẫn · 0 lượt tìm kiếmNội dung');
    });

    it('keeps a labelled element that hides nothing (e.g. a link)', () => {
      const d = doc(
        '<body><p><a aria-label="nguồn" href="https://example.com">liên kết</a></p></body>'
      );
      expect(cleanReportHtml(pickReportRoot(d)!)).toContain('liên kết');
    });
  });
});
