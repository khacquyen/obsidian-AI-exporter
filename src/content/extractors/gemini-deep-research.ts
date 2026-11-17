/**
 * Gemini Deep Research reports embedded in the conversation note (fork-only).
 *
 * Gemini shows a finished report as a chip in the model response, and loads
 * the report HTML only when the chip is opened. Verified live 2026-11-17: no
 * report content in the DOM while the panel is closed; after "Open" it renders
 * in ~5–7 s and keeps growing for a moment; the chat column stays mounted
 * while the panel is open.
 *
 * So a sync opens every chip, waits for the report to settle, reads it, closes
 * the panel again, and the report is appended to the assistant message of the
 * turn holding the chip. Citations become footnotes with a per-report prefix
 * (`[^dr1-3]`) so several reports in one note never collide.
 */

import { sanitizeHtml } from '../../lib/sanitize';
import type { DeepResearchSource } from '../../lib/types';
import { DEEP_RESEARCH_SELECTORS, DEEP_RESEARCH_CHIP_SELECTORS } from './selectors/gemini';

/** One report read from the panel. */
export interface CapturedReport {
  /** Sanitized report HTML. */
  html: string;
  sources: DeepResearchSource[];
}

/** Timing for opening a report; tests shorten it. */
export interface ReportWaitOptions {
  /** Give up on one report after this long. */
  timeoutMs: number;
  /** The report counts as loaded once its text length holds this long. */
  settleMs: number;
  pollMs: number;
}

export const DEFAULT_REPORT_WAIT: ReportWaitOptions = {
  timeoutMs: 30_000,
  settleMs: 1_200,
  pollMs: 200,
};

/** A panel that will not close should not stall the sync for long. */
const CLOSE_TIMEOUT_MS = 5_000;

/** Reports per turn index, plus how many chips could not be read. */
export interface CaptureResult {
  reports: Map<number, CapturedReport[]>;
  failed: number;
}

function first<T extends Element>(selectors: readonly string[], root: ParentNode): T | null {
  for (const selector of selectors) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function reportContent(): HTMLElement | null {
  return first<HTMLElement>(DEEP_RESEARCH_SELECTORS.content, document);
}

function panelOpen(): boolean {
  return first(DEEP_RESEARCH_SELECTORS.panel, document) !== null;
}

/** Close the report panel if it is open; resolves once it is gone. */
async function closePanel(wait: ReportWaitOptions): Promise<void> {
  if (!panelOpen()) return;
  first(DEEP_RESEARCH_CHIP_SELECTORS.closeIcon, document)?.closest('button')?.click();
  const deadline = Date.now() + Math.min(wait.timeoutMs, CLOSE_TIMEOUT_MS);
  while (panelOpen() && Date.now() < deadline) await sleep(wait.pollMs);
}

/** Wait until the report text exists and its length stops changing. */
async function waitForReport(wait: ReportWaitOptions): Promise<HTMLElement | null> {
  const deadline = Date.now() + wait.timeoutMs;
  let lastLength = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const el = reportContent();
    const length = el?.textContent?.length ?? 0;
    if (length !== lastLength) {
      lastLength = length;
      stableSince = Date.now();
    } else if (el && length > 0 && Date.now() - stableSince >= wait.settleMs) {
      return el;
    }
    await sleep(wait.pollMs);
  }
  return null;
}

/**
 * Open every report chip in the given turns and read its report.
 * A chip without an Open button (report still running) counts as failed.
 * The panel is left closed.
 */
export async function captureReports(
  turns: readonly HTMLElement[],
  readSources: () => DeepResearchSource[],
  wait: ReportWaitOptions = DEFAULT_REPORT_WAIT
): Promise<CaptureResult> {
  const reports = new Map<number, CapturedReport[]>();
  let failed = 0;

  for (const [turnIndex, turn] of turns.entries()) {
    for (const selector of DEEP_RESEARCH_CHIP_SELECTORS.chip) {
      for (const chip of turn.querySelectorAll<HTMLElement>(selector)) {
        await closePanel(wait);
        const open = first<HTMLElement>(DEEP_RESEARCH_CHIP_SELECTORS.openButton, chip);
        if (!open) {
          failed++;
          continue;
        }
        open.click();
        const content = await waitForReport(wait);
        if (content) {
          const list = reports.get(turnIndex) ?? [];
          list.push({ html: sanitizeHtml(content.innerHTML), sources: readSources() });
          reports.set(turnIndex, list);
        } else {
          failed++;
        }
        await closePanel(wait);
      }
    }
  }
  return { reports, failed };
}

/**
 * Report HTML ready to append to an assistant message: citations become
 * footnote refs labelled `<label>-<N>`, followed by the footnote definitions.
 * Both are converted by the shared Turndown footnote rules.
 */
export function reportToEmbeddedHtml(report: CapturedReport, label: string): string {
  const template = document.createElement('template');
  template.innerHTML = report.html;
  const root = template.content;

  root.querySelectorAll('sources-carousel-inline').forEach(el => el.remove());

  // data-turn-source-index is 1-based: N → sources[N-1]
  root.querySelectorAll('sup[data-turn-source-index]').forEach(sup => {
    const index = parseInt(sup.getAttribute('data-turn-source-index') ?? '', 10);
    const target = sup.closest('source-footnote') ?? sup;
    if (!report.sources[index - 1]) {
      target.remove();
      return;
    }
    const ref = document.createElement('span');
    ref.setAttribute('data-footnote-ref', `${label}-${index}`);
    ref.textContent = 'REF';
    target.replaceWith(ref);
  });

  const parts = ['<hr>', template.innerHTML];
  if (report.sources.length > 0) {
    const refs = document.createElement('div');
    const heading = document.createElement('h1');
    heading.textContent = 'References';
    refs.append(heading);
    report.sources.forEach((source, i) => {
      const def = document.createElement('p');
      def.setAttribute('data-footnote-def', `${label}-${i + 1}`);
      def.setAttribute('data-footnote-url', source.url);
      def.textContent = source.title;
      refs.append(def);
    });
    parts.push(refs.innerHTML);
  }
  return parts.join('\n');
}
