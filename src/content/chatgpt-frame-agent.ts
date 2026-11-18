/**
 * Agent injected into ChatGPT's MCP app frames (ADR-046).
 *
 * Runs in every frame on `*.web-sandbox.oaiusercontent.com` (manifest
 * `all_frames`). It answers a report request only from its direct parent, and
 * only when that parent is chatgpt.com or another app sandbox frame; it
 * replies to that origin only.
 *
 * Measured live 2026-11-18: the app frame itself holds no report text, only
 * one nested iframe. So when its own document is empty, the agent reads its
 * nested frames: directly when they are same-origin (srcdoc / about:blank),
 * otherwise by relaying the request to the agent running inside them.
 */

import {
  CHATGPT_ORIGIN,
  FRAME_REPORT_REPLY,
  FRAME_REPORT_REQUEST,
  cleanReportHtml,
  isFrameReportReply,
  isFrameReportRequest,
  isSandboxOrigin,
  pickReportRoot,
  type FrameReportReply,
} from '../lib/chatgpt-frame-protocol';

/** How long a frame waits for its nested frames' agents. */
const NESTED_TIMEOUT_MS = 1000;

/** Report HTML of a same-origin document, or '' (cross-origin access throws). */
function readDocument(doc: Document | null): string {
  if (!doc) return '';
  const root = pickReportRoot(doc);
  return root ? cleanReportHtml(root) : '';
}

function originOf(frame: HTMLIFrameElement): string {
  try {
    return new URL(frame.src).origin;
  } catch {
    return 'null';
  }
}

/** Ask the agent inside a cross-origin nested frame; '' on timeout. */
function relay(frame: HTMLIFrameElement, nonce: string): Promise<string> {
  const target = originOf(frame);
  if (!isSandboxOrigin(target) || !frame.contentWindow) return Promise.resolve('');
  return new Promise(resolve => {
    const done = (html: string): void => {
      window.removeEventListener('message', onReply);
      clearTimeout(timer);
      resolve(html);
    };
    const onReply = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow || event.origin !== target) return;
      if (isFrameReportReply(event.data) && event.data.nonce === nonce) done(event.data.html);
    };
    const timer = setTimeout(() => done(''), NESTED_TIMEOUT_MS);
    window.addEventListener('message', onReply);
    frame.contentWindow!.postMessage({ type: FRAME_REPORT_REQUEST, nonce }, target);
  });
}

/** This frame's report: its own text, else the first nested frame that has one. */
async function collectReport(nonce: string): Promise<{ html: string; nested: string[] }> {
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
  const nested = frames.map(originOf);
  const own = readDocument(document);
  if (own) return { html: own, nested };

  for (const frame of frames) {
    let direct = '';
    try {
      direct = readDocument(frame.contentDocument);
    } catch {
      // cross-origin: contentDocument access throws in some engines
    }
    const html = direct || (await relay(frame, nonce));
    if (html) return { html, nested };
  }
  return { html: '', nested };
}

export async function handleFrameMessage(event: MessageEvent): Promise<void> {
  if (event.source !== window.parent) return;
  if (event.origin !== CHATGPT_ORIGIN && !isSandboxOrigin(event.origin)) return;
  if (!isFrameReportRequest(event.data)) return;

  const { html, nested } = await collectReport(event.data.nonce);
  const reply: FrameReportReply = {
    type: FRAME_REPORT_REPLY,
    nonce: event.data.nonce,
    html,
    nestedFrames: nested.length,
    nestedOrigins: nested,
  };
  window.parent.postMessage(reply, event.origin);
}

// The top frame never needs the agent; only embedded frames do.
if (window.top !== window) {
  window.addEventListener('message', event => void handleFrameMessage(event));
}
