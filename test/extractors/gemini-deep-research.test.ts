/**
 * Fork: Gemini Deep Research reports embedded in the conversation note.
 *
 * The page is simulated from the two real captures: chat-simple.html (a
 * conversation) and deep-research.html (an open report panel). A report chip
 * is put in one model response; clicking its Open button mounts the captured
 * panel the way Gemini does, and its close button unmounts it.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GeminiExtractor } from '../../src/content/extractors/gemini';
import { reportToEmbeddedHtml } from '../../src/content/extractors/gemini-deep-research';
import { conversationToNote } from '../../src/content/markdown';
import { htmlToMarkdown } from '../../src/content/markdown-rules';
import type { TemplateOptions } from '../../src/lib/types';
import {
  clearFixture,
  loadFixture,
  resetLocation,
  setGeminiLocation,
} from '../fixtures/dom-helpers';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/html/gemini');
const chatHtml = readFileSync(resolve(FIXTURES, 'chat-simple.html'), 'utf-8');
const panelHtml = readFileSync(resolve(FIXTURES, 'deep-research.html'), 'utf-8');

const FAST_WAIT = { timeoutMs: 2_000, settleMs: 150, pollMs: 10 };

const TEMPLATE: TemplateOptions = {
  includeId: true,
  includeTitle: true,
  includeSource: true,
  includeDates: true,
  includeTags: true,
  includeMessageCount: true,
  messageFormat: 'callout',
  userCalloutType: 'QUESTION',
  assistantCalloutType: 'NOTE',
};

/** Mount the captured report panel, the second half of its text arriving later. */
function mountPanel(): void {
  const holder = document.createElement('div');
  holder.className = 'test-panel-holder';
  holder.innerHTML = panelHtml;
  const content = holder.querySelector('#extended-response-markdown-content')!;
  const children = [...content.children];
  const tail = children.slice(Math.floor(children.length / 2));
  tail.forEach(el => el.remove());
  setTimeout(() => document.body.append(holder), 30);
  setTimeout(() => content.append(...tail), 80);
}

/** A report chip like Gemini's; `openable: false` = report still running. */
function chipHtml(openable = true): string {
  return `<immersive-entry-chip><gem-processing-card class="completed">
    <span class="card-title">Report chip</span>
    ${openable ? '<div class="actions"><gem-button class="open-button"><button>Mở</button></gem-button></div>' : ''}
  </gem-processing-card></immersive-entry-chip>`;
}

function loadPage(chips: string[] = [chipHtml()], turnIndex = 1): void {
  loadFixture(chatHtml);
  const turn = document.querySelectorAll('.conversation-container')[turnIndex];
  turn.querySelector('model-response')?.insertAdjacentHTML('beforeend', chips.join(''));
  document.addEventListener('click', onClick);
}

function onClick(event: Event): void {
  const button = (event.target as Element).closest('button');
  if (!button) return;
  if (button.closest('gem-button.open-button')) mountPanel();
  if (button.querySelector('mat-icon[fonticon="close"]')) {
    document.querySelectorAll('.test-panel-holder').forEach(el => el.remove());
  }
}

function newExtractor(): GeminiExtractor {
  const extractor = new GeminiExtractor();
  extractor.reportWait = FAST_WAIT;
  return extractor;
}

describe('Gemini Deep Research embedded in the conversation (fork)', () => {
  beforeEach(() => {
    clearFixture();
    setGeminiLocation('e65dc37c9f338dfd');
  });

  afterEach(() => {
    document.removeEventListener('click', onClick);
    clearFixture();
    resetLocation();
  });

  it('the captured panel carries the close icon the extension clicks', () => {
    loadFixture(panelHtml);
    const icon = document.querySelector(
      'deep-research-immersive-panel button mat-icon[fonticon="close"]'
    );
    expect(icon?.closest('button')).not.toBeNull();
  });

  it('syncs the conversation with the full report when the panel is closed', async () => {
    loadPage();
    const turns = document.querySelectorAll('.conversation-container').length;

    const result = await newExtractor().extract();

    expect(result.success).toBe(true);
    const data = result.data!;
    expect(data.type).not.toBe('deep-research');
    expect(data.id).toBe('e65dc37c9f338dfd');
    expect(data.messages.length).toBe(turns * 2);
    expect(result.warnings ?? []).toEqual([]);
    // the panel is closed again afterwards
    expect(document.querySelector('deep-research-immersive-panel')).toBeNull();

    const note = conversationToNote(data, TEMPLATE);
    const refs = new Set(note.body.match(/\[\^dr1-\d+\](?!:)/g));
    const defs = note.body.match(/^> \[\^dr1-\d+\]:/gm) ?? [];
    expect(refs.size).toBeGreaterThan(10);
    expect(defs.length).toBeGreaterThanOrEqual(refs.size);
    for (const ref of refs) expect(note.body).toContain(`> ${ref}:`);
    // no unprefixed footnotes leak in
    expect(note.body).not.toMatch(/\[\^\d+\]/);
    // the report sits in the assistant message of turn 2, before turn 3
    const reportAt = note.body.indexOf('[^dr1-');
    const lastQuestion = note.body.lastIndexOf('[!QUESTION]');
    expect(reportAt).toBeGreaterThan(0);
    expect(reportAt).toBeLessThan(lastQuestion);
  });

  it('waits for the report text to stop growing', async () => {
    loadPage();
    const full = new DOMParser()
      .parseFromString(panelHtml, 'text/html')
      .querySelectorAll('#extended-response-markdown-content sup[data-turn-source-index]').length;

    const result = await newExtractor().extract();
    const html = result.data!.messages[3].content;

    expect(html.match(/data-footnote-ref=/g)?.length).toBe(full);
  });

  it('still syncs the conversation when a report panel is already open', async () => {
    loadPage();
    loadFixture(document.body.innerHTML + panelHtml);
    document.addEventListener('click', onClick);

    const result = await newExtractor().extract();

    expect(result.success).toBe(true);
    expect(result.data?.type).not.toBe('deep-research');
    expect(result.data?.messages.length).toBe(6);
  });

  it('numbers two reports apart', async () => {
    loadPage([chipHtml(), chipHtml()]);

    const result = await newExtractor().extract();
    const body = conversationToNote(result.data!, TEMPLATE).body;

    expect(body).toMatch(/\[\^dr1-1\]/);
    expect(body).toMatch(/\[\^dr2-1\]/);
  });

  it('warns and keeps the chat when a report is still running', async () => {
    loadPage([chipHtml(false)]);

    const result = await newExtractor().extract();

    expect(result.success).toBe(true);
    expect(result.data?.messages.length).toBe(6);
    expect(result.warnings?.join(' ')).toContain('1 Deep Research report(s) could not be loaded');
  });

  it('gives up on a report that never loads', async () => {
    loadPage();
    document.removeEventListener('click', onClick);
    const extractor = newExtractor();
    extractor.reportWait = { timeoutMs: 200, settleMs: 50, pollMs: 10 };

    const result = await extractor.extract();

    expect(result.success).toBe(true);
    expect(result.warnings?.join(' ')).toContain('could not be loaded');
  });
});

describe('reportToEmbeddedHtml', () => {
  const sources = [
    { index: 0, url: 'https://a.example/x', title: 'Source A', domain: 'a.example' },
    { index: 1, url: 'javascript:alert(1)', title: 'Bad [link]', domain: 'unknown' },
  ];

  it('prefixes citations and appends their definitions', () => {
    const html =
      '<h1>R</h1><p>One<source-footnote><sup data-turn-source-index="1">1</sup></source-footnote>' +
      ' two<sup data-turn-source-index="2">2</sup> three<sup data-turn-source-index="9">9</sup></p>' +
      '<sources-carousel-inline>carousel</sources-carousel-inline>';

    const md = htmlToMarkdown(reportToEmbeddedHtml({ html, sources }, 'dr3'));

    expect(md).toContain('One[^dr3-1]');
    expect(md).toContain('two[^dr3-2]');
    expect(md).not.toContain('9');
    expect(md).not.toContain('carousel');
    expect(md).toContain('[^dr3-1]: [Source A](https://a.example/x)');
    expect(md).not.toContain('javascript:');
    expect(md).toMatch(/\[\^dr3-2\]: Bad \\\[link\\\]/);
  });

  it('adds no References heading without sources', () => {
    const md = htmlToMarkdown(reportToEmbeddedHtml({ html: '<p>x</p>', sources: [] }, 'dr1'));
    expect(md).not.toContain('References');
  });
});
