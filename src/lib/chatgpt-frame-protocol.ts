/**
 * Message protocol between the chatgpt.com content script and the agent that
 * runs inside ChatGPT's MCP app frames (ADR-046).
 *
 * ChatGPT renders Deep Research reports (and other connector apps) inside
 * `iframe`s served from `https://<id>.web-sandbox.oaiusercontent.com`, sandboxed
 * with `allow-scripts allow-same-origin`. The parent page cannot read that DOM,
 * but an extension content script injected into the frame can, and it answers
 * a nonce-tagged `postMessage` request from the parent.
 *
 * Measured live 2026-11-18: the frame host is
 * `connector-id-<hash>.web-sandbox.oaiusercontent.com` (no "deep-research" in
 * it any more) and its `title` is localized ("Nghiên cứu sâu"), so neither the
 * title nor the host name identifies Deep Research; the frame sits under
 * `div[data-mcp-app-frame]` inside the answer's `div[data-turn-key]`.
 */

export const CHATGPT_ORIGIN = 'https://chatgpt.com';

/** Parent → frame: ask for the frame's report. */
export const FRAME_REPORT_REQUEST = 'g2o:chatgpt-frame-report-request';

/** Frame → parent: the report HTML. */
export const FRAME_REPORT_REPLY = 'g2o:chatgpt-frame-report-reply';

export interface FrameReportRequest {
  type: typeof FRAME_REPORT_REQUEST;
  nonce: string;
}

export interface FrameReportReply {
  type: typeof FRAME_REPORT_REPLY;
  nonce: string;
  /** Inner HTML of the report root, already stripped of scripts and controls. */
  html: string;
  /** Diagnostics for live verification: how many iframes the frame contains. */
  nestedFrames: number;
  /** Diagnostics: origin of each nested iframe ('null' for srcdoc/about:blank). */
  nestedOrigins?: string[];
}

const SANDBOX_ORIGIN = /^https:\/\/[a-z0-9-]+\.web-sandbox\.oaiusercontent\.com$/;

/** Whether an origin is one of ChatGPT's app sandbox hosts (exact match, no suffix tricks). */
export function isSandboxOrigin(origin: string): boolean {
  return SANDBOX_ORIGIN.test(origin);
}

export function isFrameReportRequest(data: unknown): data is FrameReportRequest {
  const d = data as Partial<FrameReportRequest> | null;
  return !!d && d.type === FRAME_REPORT_REQUEST && typeof d.nonce === 'string' && d.nonce !== '';
}

export function isFrameReportReply(data: unknown): data is FrameReportReply {
  const d = data as Partial<FrameReportReply> | null;
  return (
    !!d &&
    d.type === FRAME_REPORT_REPLY &&
    typeof d.nonce === 'string' &&
    typeof d.html === 'string' &&
    typeof d.nestedFrames === 'number'
  );
}

/** Elements that are app chrome or executable, never report text. */
const STRIP =
  'script, style, noscript, template, button, svg, iframe, form, input, select, textarea';

/**
 * The report root of a frame document: the `article`/`main` with the most
 * text, else `body`. The frame also renders app chrome (download and expand
 * buttons), which a root closer to the prose leaves out.
 */
export function pickReportRoot(doc: Document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('article, main, [role="main"]'));
  const best = candidates.reduce<HTMLElement | null>(
    (top, el) =>
      (el.textContent?.trim().length ?? 0) > (top?.textContent?.trim().length ?? 0) ? el : top,
    null
  );
  return best ?? doc.body;
}

/**
 * Report HTML with scripts and controls removed; empty when no text is left.
 *
 * The report header shows counts as animated digit rollers (measured live
 * 2026-11-18): `span[aria-label]` holding an `aria-hidden` strip of every digit
 * 0-9, so its text reads "0 0 1 2 … 9". The label carries the real value, so
 * a labelled element is replaced by its label and anything else hidden from
 * assistive technology is dropped.
 */
export function cleanReportHtml(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll(STRIP).forEach(el => el.remove());
  clone.querySelectorAll('[aria-label]').forEach(el => {
    if (el.querySelector('[aria-hidden="true"]')) {
      el.replaceWith(el.ownerDocument.createTextNode(el.getAttribute('aria-label') ?? ''));
    }
  });
  clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());
  return clone.textContent?.trim() ? clone.innerHTML.trim() : '';
}
