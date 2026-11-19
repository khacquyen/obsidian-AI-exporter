# ADR-046: Read ChatGPT Deep Research reports through an agent injected into the app frame

- Status: Accepted (live verification pending)
- Date: 2026-11-18
- Related: issue #283 (report frame unreadable), [ADR-043](043-extractors-customize-through-hooks.md)
  (customize through hooks, never override `extract()`)

## Context

ChatGPT shows a Deep Research report inside an app `iframe`, not as an ordinary answer. Until
now the extractor only detected that frame and warned that the report could not be exported
(#283), on the assumption that an extension cannot read a cross-origin frame.

Measured live on 2026-11-18 on a ChatGPT Project conversation (Vietnamese UI):

- The frame is `iframe[title="Nghiên cứu sâu"]`. The title is localized, no longer
  `internal://deep-research`.
- Its host is `connector-id-<hash>.web-sandbox.oaiusercontent.com`. The host no longer
  contains `deep-research` or `deep_research`.
- It sits under `div[data-mcp-app-frame]` inside the answer unit of the turn
  (`div[data-turn-key]`).
- `sandbox="allow-scripts allow-same-origin allow-forms"`.

So all three detection selectors missed it: the report was dropped silently, with no warning,
and the note held only the prompt and ChatGPT's "research started" line.

Because the frame keeps its own origin (`allow-same-origin`), an extension content script whose
`matches` and host permissions include that origin is injected into it and can read its DOM.

## Decision

1. **Detect app frames by structure and host**: `[data-mcp-app-frame] iframe` and
   `iframe[src*=".web-sandbox.oaiusercontent.com"]`, in addition to the old selectors. Neither
   names Deep Research, so every app frame is a candidate; a frame is exported only if its
   agent returns text.
2. **Frame agent** (`src/content/chatgpt-frame-agent.ts`): a second content script, `all_frames`,
   on `https://*.web-sandbox.oaiusercontent.com/*`. It answers a nonce-tagged `postMessage`
   request only from its direct parent, and only when that parent is `https://chatgpt.com` or
   another app sandbox origin; it replies to that origin only. It returns the inner HTML of the
   `article`/`main` with the most text (else `body`), with scripts and controls removed.
   - Measured live after the first build: the app frame itself holds no text and exactly one
     nested `iframe` whose origin is `null` (`srcdoc`). When its own document is empty, the agent
     reads nested frames directly through `contentDocument` when same-origin, and otherwise relays
     the request to the agent inside them (1 s wait).
   - The report header shows counts as animated digit rollers: `span[aria-label]` around an
     `aria-hidden` strip of every digit, whose text reads "0 0 1 2 … 9". A labelled element that
     hides content is replaced by its label; other `aria-hidden` content is dropped.
3. **Parent side**: before the turns are harvested, `ChatGPTExtractor.collectMessages()` asks
   every app frame on the page (`requestFrameReports`, 2.5 s timeout, above the agent's nested
   wait). Replies are accepted only from an exact `https://<label>.web-sandbox.oaiusercontent.com`
   origin, from the frame's own `contentWindow`, with the current nonce. The report is sanitized
   like any answer block, gets an `h2` with the frame title, and becomes **its own assistant
   message** right after the turn's answer (id `<turn key>:app-frame-<n>`). Append mode adds
   messages by count, so a report merged into the existing answer was never added to a note saved
   before the report became readable ("No new messages to append", measured live). The legacy
   (pre-2026-09) layout keeps the report inside the answer.
4. A frame that does not answer keeps the old #283 behaviour: warn (or refuse a note that would
   hold only the prompt).

New host permission `https://*.web-sandbox.oaiusercontent.com/*`, justified in
`docs/store/listing.md`.

## Consequences

- Reading happens through a message protocol, not the background: no new permission besides
  the host, and the report never leaves the tab before the normal save path.
- The page's own scripts can see the request/reply messages; they carry only the report the
  page already displays.
- The console line `[G2O] App frame answered: <chars>, <n> nested frame(s) [origins]` is the
  first thing to check when a report is missing.
- Limits: content that renders only after the request is missed; a report that becomes
  readable in a turn that is not the last one is appended at the end of the note, because append
  mode is count-based.
- Non-Deep-Research app frames that render text are exported too, under their own title.

## Amendment 2026-11-19: read frames on every scroll window

Measured live on a conversation with two Deep Research reports (Vietnamese UI): ChatGPT mounts a
report frame only while its turn is near the viewport, and remounts a new `iframe` element each
time. The parent asked the frames once, before the auto-scroll pass, and keyed reports by element,
so a sync saved neither report and gave no warning. Asked directly while mounted, both frames
answered (about 110k and 86k characters).

- The auto-scroll pass runs an async `beforeHarvest` step on each mounted window
  (`ScrollConfig.beforeHarvest`, `AccumulateOptions.beforeHarvest`); ChatGPT uses it to ask the
  frames mounted in that window.
- Reports are keyed by `<turn key>:<frame index within the turn>`, so a remounted frame finds the
  report read in an earlier window and is not asked again.
- A frame that does not answer is asked again in later windows, up to 3 times, then counts as
  unreadable for the #283 warning. Frames outside any turn (a hidden zero-height duplicate) are
  ignored.
