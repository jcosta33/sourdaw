---
type: spec
id: SPEC-webgpu-text-pipeline
title: WebGPU timeline text pipeline
status: draft
owner: The Sourdaw team
related:
    - ../webgpu-automation-rendering/spec.md
    - ../render-parity-instrumentation/spec.md
---

# WebGPU timeline text pipeline

## Intent

`getPreferredRendererBackend()` picks WebGPU on any machine that exposes `navigator.gpu`, which is
every current Chromium on macOS and Windows. That backend draws **one** of the arrangement's **eight**
text layers. The other seven are absent, and the one that exists ships four correctness defects.

This spec fixes the whole text layer of the WebGPU timeline renderer: which strings get drawn, how
they are rasterised, how they are batched, and how they stay in agreement with the Canvas2D backend
that is still the fallback. Divergent text between the two backends is a worse outcome than missing
text — it is invisible in review and surfaces as "it looks different on my machine" — so parity is a
requirement here, not a nicety.

## What is actually true today

The claim this phase was opened on ("the WebGPU renderer draws zero text") is **wrong in one
direction and understates the problem in another**. Verified against `bb9982b93` on `main`.

### Backend selection

| Fact                                                                            | Evidence                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Two backends exist: `'webgpu'` and `'canvas2d'`.                                 | `src/modules/Arrangement/models/RendererBackend.ts:1`                        |
| Selection is presence of `navigator.gpu`, with no capability probe and no user override. | `src/modules/Arrangement/models/RendererBackend.ts:10-12`             |
| WebGPU is tried first; Canvas2D runs only if the factory returns `null`.         | `src/modules/Arrangement/presentations/renderers/createTimelineRenderer.ts:7-18` |
| The factory returns `null` on a missing `navigator.gpu` or on any init throw.    | `createWebGpuRenderer.ts:258-260` and `:740-742`                            |
| One caller, one surface.                                                         | `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:270`        |

So on a WebGPU-capable machine the WebGPU renderer is what the user gets, always, with no way to ask
for the other one.

### The eight text layers, and who draws them

| #  | Layer                        | Canvas2D draw site                | WebGPU |
| -- | ---------------------------- | --------------------------------- | ------ |
| 1  | Clip name                    | `clipDrawing.ts:163`              | **yes** |
| 2  | Clip type badge (`MIDI` / `AUDIO` / `… ⧉`), only when the clip is wider than 50 CSS px | `clipDrawing.ts:180` | no |
| 3  | `Generating...` on a pending AI clip | `clipDrawing.ts:57`       | no |
| 4  | Folder-track name, uppercased | `createCanvasRenderer.ts:199`     | no |
| 5  | Empty-track `name  ·  KIND`   | `createCanvasRenderer.ts:206`     | no |
| 6  | Empty-track hint `Drop audio/MIDI here or use Draw tool` | `createCanvasRenderer.ts:210` | no |
| 7  | Variation lane name           | `createCanvasRenderer.ts:233`     | no |
| 8  | Take name                     | `createCanvasRenderer.ts:310`     | no |

**Corrected claim: seven of eight text layers are missing, not eight.** Clip names *are* drawn, by a
per-string CPU raster uploaded as a texture (`createClipLabelTextureCache.ts`, wired at
`createWebGpuRenderer.ts:406-442` and composited at `:691-699`). The survey pass missed it.

### Four defects in the one layer that does exist

**D1 — a live texture can be destroyed mid-frame.** `MAX_CACHED_LABELS = 256`
(`createClipLabelTextureCache.ts:26`) is half of `MAX_LABELS = 512`
(`createWebGpuRenderer.ts:74`). Eviction destroys the GPU texture synchronously inside `acquire`
(`createClipLabelTextureCache.ts:200-202`), but bind groups are collected during the clip pass and
only encoded after it, at `createWebGpuRenderer.ts:691-699`. A frame with 257 or more distinct
labels therefore destroys a texture whose bind group is still queued for that same frame. The
consequence is not one missing label — it is a validation error at submit and **the whole frame
lost**. This is reachable with a normal project at a normal zoom.

**D2 — guaranteed cache thrash above 256 labels.** The same two constants. Past 256 distinct
on-screen labels, every frame evicts entries it will ask for again on the next frame, so the tail of
the label set is re-rasterised every frame forever.

**D3 — no integer device-pixel snapping.** The quad origin is `layout.xCssPx * dpr`
(`createWebGpuRenderer.ts:426-427`), and `layout.xCssPx` descends from `beatToX`
(`createWebGpuRenderer.ts:394-396`), a continuous function of `viewportStartBeat`. The sampler is
`linear` in both directions (`createWebGpuRenderer.ts:356`). A cached raster drawn at a fractional
destination through a linear filter is resampled: blurry at rest and shimmering during any scroll or
zoom. This is the defect users notice first and report last, because they describe it as "the GPU
one looks fuzzy".

**D4 — the raster box is sized from advance width, not ink.**
`createClipLabelTextureCache.ts:101` measures with `measureText(text).width`, which is the advance,
and the box height is the fixed pair `ASCENT 10 / DESCENT 4` (`clipLabel.ts:32-38`). Any glyph whose
ink exceeds its advance — italics, overhanging `f`, several non-Latin scripts — or whose ascent
exceeds 10 CSS px at a 10 px font — emoji, stacked diacritics — is clipped by the texture edge. The
Canvas2D backend has no such box and does not clip.

### A fifth, smaller divergence

The WebGPU path quantises the condensation budget to whole CSS px before handing it to `fillText`
(`createClipLabelTextureCache.ts:184`, used at `:139`), while Canvas2D passes the unrounded value
(`clipDrawing.ts:163`). The two backends therefore condense the same string into budgets that differ
by up to 0.5 CSS px. Sub-pixel, but it is exactly the class of drift that accumulates unnoticed.

## Non-goals

- The wider WebGPU renderer: rects, waveforms, MIDI note previews, grid, playhead. Only text.
- The Canvas2D backend's future. It stays the fallback and, for this phase, the reference.
- Automation-curve rendering (`../webgpu-automation-rendering/spec.md`).
- Take lanes, variation lanes, folder rows and the loop region as *geometry* — the WebGPU renderer
  draws none of them. See "Out-of-scope observations".
- Backend selection policy. `getPreferredRendererBackend()` is not changed here.

## Recommendation

**Keep whole-string Canvas2D rasterisation as the glyph source; replace per-string textures with one
shared shelf-packed atlas drawn in a single instanced draw; generalise it from clip names to all
eight layers.**

These are two separable decisions and both should be stated plainly.

### Decision 1 — the glyph source stays Canvas2D whole-string raster

The load-bearing reason is that `fillText` is not a drawing call, it is a CSS inline layout call. The
HTML Standard's text preparation algorithm forms "a hypothetical infinitely-wide CSS line box
containing a single inline box containing the text", applies `direction`, `font-kerning`,
`font-stretch` and `font-variant-caps`, and returns positioned glyphs
(https://html.spec.whatwg.org/multipage/canvas.html#text-preparation-algorithm). That is
HarfBuzz-class shaping, the Unicode bidirectional algorithm, the platform font fallback cascade and
colour-emoji support, for free, on user-supplied strings. Track and clip names are user-supplied.

The rejected alternatives, each for a sourced reason:

- **SDF / MSDF.** Documented as a poor fit at exactly our size. Our labels are 7–10 CSS px
  (`clipLabel.ts:20`, `createCanvasRenderer.ts:198/202/209/232/309`, `clipDrawing.ts:178`). Epic:
  SDF "does not support hinting. This can negatively affect quality at small font sizes"
  (https://dev.epicgames.com/documentation/en-us/unreal-engine/using-signed-distance-field-text-rendering-in-unreal-engine).
  Godot lists "Fonts at small sizes will not look as clear as rasterized fonts, due to the lack of
  hinting" (https://docs.godotengine.org/en/stable/tutorials/ui/gui_using_fonts.html). The MSDF
  author's own tool states `screenPxRange()` "must never be lower than 1. If it is lower than 2,
  there is a high probability that the anti-aliasing will fail"
  (https://github.com/Chlumsky/msdfgen) — at 7–10 px that constraint is the operating point, not an
  edge case. SDF is also monochrome, which loses emoji
  (https://css-tricks.com/techniques-for-rendering-text-with-webgl/). Lineage: Green, Valve,
  SIGGRAPH 2007 (https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf);
  Chlumský, CGF 2018 (https://onlinelibrary.wiley.com/doi/abs/10.1111/cgf.13265).
- **A hand-built per-glyph atlas.** Correct per-glyph placement needs the shaping result, and
  Canvas2D will not give it to you: Skia's own design document says Canvas2D does not provide "the
  low-level information needed to correctly measure, hit-test, and draw the text as positioned
  glyphs" (https://skia.org/docs/dev/design/text_c2d/); per-glyph metrics remain a proposal
  (https://github.com/WICG/canvas-formatted-text/blob/main/explainer-metrics.md). So a glyph atlas
  means shipping shaping, bidi and a fallback chain ourselves — the road Mapbox took, which required
  a separate ICU port for `applyArabicShaping()` and `processBidirectionalText()`
  (https://github.com/mapbox/mapbox-gl-rtl-text), and Figma took, at the cost of "our own text
  layout engine" (https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/) and a
  bespoke fallback cascade (https://www.figma.com/blog/when-fonts-fall/). A HarfBuzz WASM build is
  ~180 KB (https://github.com/harfbuzz/harfbuzzjs/discussions/30). That is a font-engine project,
  and it buys us nothing our eight fixed-size label kinds need.
- **A Canvas2D or DOM overlay layer stacked on the WebGPU canvas.** Honestly assessed rather than
  dismissed: this is a real, sanctioned technique — MDN recommends multi-canvas layering split by
  change frequency (https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas),
  Chrome DevTools' own performance panel draws its timeline text with `context.fillText`
  (https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/ui/legacy/components/perf_ui/TimelineGrid.ts),
  and Excalidraw does the same. It would give parity **by construction**, because it would run the
  identical `fillText` calls. It is rejected as the primary approach for three reasons: every layer
  "requires memory and management, and that's not free"
  (https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count); a second
  surface means two resizes, two scroll transforms and two DPR paths to keep in lockstep, which is a
  new divergence surface rather than a closed one; and the `TimelineRenderer` contract
  (`RendererBackend.ts:3-8`) is single-canvas, so it would have to change. **It remains the
  recommended retreat** if the atlas work in Decision 2 proves larger than the phase — see Open
  questions.

### Decision 2 — one shared atlas, one instanced draw

The current shape is one texture and one `setBindGroup` + `draw` per label, up to 512 per frame
(`createWebGpuRenderer.ts:691-699`). That is the known wrong shape: "Changing any piece of state
while in a render/compute pass has a performance cost"
(https://toji.dev/webgpu-best-practices/bind-groups.html), and a WebRender author's working rule is
that past ~100 draw calls "this probably going to stutter on some mobile device or low end intel
GPU" against frames drawing 20k+ quads (https://nical.github.io/drafts/gui-gpu-notes.html). It also
cannot be rescued by bindless indexing — WebGPU's proposal is explicitly "not the addition of
'bindless'" (https://github.com/gpuweb/gpuweb/blob/main/proposals/sized-binding-arrays.md).

The standard remedy is a shared atlas plus instancing: "have a simple unit quad mesh that is drawn
using instancing… the parameters of the quad can go into a vertex buffer with instance step mode"
(https://nical.github.io/drafts/gui-gpu-notes.html). Shelf packing is the established allocator for
this (glyphon/etagere, https://github.com/grovesNL/glyphon). deck.gl's `TextLayer` is the closest
shipping analogue on this exact substrate: Canvas2D rasterisation into one atlas texture
(https://deck.gl/docs/api-reference/layers/text-layer).

### Why zoom does not force our hand

The usual argument against caching rasters in a zooming view is that zoom rescales the text. In a
timeline it does not. No DAW or NLE surveyed scales clip-label text with horizontal zoom; they hold a
fixed point size and truncate or hide. Cubase ships a preference literally named "Hide Truncated
Event Names — When zooming or resizing elements, the events can become very small so that the name is
no longer completely visible"
(https://archive.steinberg.help/cubase_pro_artist/v9/en/cubase_nuendo/topics/preferences/preferences_event_display_r.html).
REAPER exposes `itemlabel_hideheight`, "Hide labels when the media item take lane height is less
than" a pixel threshold (https://mespotin.uber.space/Ultraschall/Reaper_Config_Variables.html) — a
pixel threshold presumes fixed-size text. Label size lives in a separate global setting in every
product that exposes one at all: REAPER's "Media item label font", Avid Media Composer's Timeline →
Set Font (https://kb.avid.com/pkb/articles/en_US/How_To/How-to-set-font-and-font-size-in-the-timeline-clip-notes-window-in-Media-Composer),
Ableton's Settings → Display zoom (https://www.ableton.com/en/manual/first-steps/), Bitwig's UI
scaling (https://www.bitwig.com/userguide/latest/the_dashboard/). Clip names are a boolean toggle in
Premiere, Studio One and Pro Tools, never a size. Flame charts do the same thing — "Mouse click zooms
the visualization horizontally, revealing function names previously elided"
(https://www.brendangregg.com/flamegraphs.html). Map labels are screen-space with collision
deconfliction (https://maplibre.org/maplibre-style-spec/layers/).

**No vendor states "labels do not scale with zoom" verbatim, and I found no counterexample either.**
The conclusion is inference from convergent official documentation, and it is recorded as inference.
Our own constants already agree: `CLIP_LABEL_FONT` is a fixed `500 10px` (`clipLabel.ts:20`).

The consequence is the important part. **Zoom is a layout problem here, not a rasterisation
problem.** Rasters need re-cutting on a change of text, style or DPR — not on zoom.

### The one thing zoom currently does touch

Our labels are *condensed* rather than truncated: Canvas2D's `maxWidth` argument squeezes the glyph
run to fit (`clipDrawing.ts:163`, documented at `clipLabel.ts:11-16`). Because the squeeze factor
moves with zoom, the raster is zoom-dependent after all, which is why the cache key carries a
quantised width (`createClipLabelTextureCache.ts:184-185`) and why a zoom drag re-cuts every label
at every 1 px step.

Adopting the field standard — fixed size, truncate with an ellipsis, hide below a floor — makes the
cache key `(text, style, dpr)` and removes zoom from rasterisation entirely. It is both the
field-standard behaviour and the cheaper engineering. It is also a **visible change to how every
existing project looks**, so it is carried as the one open question below rather than assumed.

## Requirements

### AC-001 — Every text layer the Canvas2D backend draws, the WebGPU backend draws

All eight layers in the table above must be emitted by the WebGPU backend. The check is a census
that (i) derives its population from a shared `timelineTextLayers` registry that the drawing code
itself consumes, (ii) asserts a WebGPU emission per member, (iii) carries exemptions in a named,
reason-bearing table, and (iv) ships with a deliberately broken fixture. Per ADR 0015 rule 4 it must
also pin presence: a source scan of `createCanvasRenderer.ts` and `clipDrawing.ts` must find exactly
as many `fillText` call sites as the registry has members, so a ninth unregistered label cannot grow
silently.

Mutation that reds it: delete the `addClipLabel` call at `createWebGpuRenderer.ts:630`.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextLayerCensus.spec.ts`

### AC-002 — Both backends place every label at the same coordinates, at interior zoom and non-default DPR

Every layer's position must come from one pure layout module that both backends call, as
`computeClipLabelLayout` already does for layer 1 (`clipLabel.ts:66`). Parity is asserted at
`pixelsPerBeat ∈ {8, 37, 120, 480, 1900}` — five points including three interior ones, because
asserting only the ends of a zoom range cannot detect a reshaped curve — crossed with
`devicePixelRatio ∈ {1, 1.5, 2, 3}` and with a non-integer `scrollY`. Tolerance is zero CSS px.

Observation that violates it: any layer whose Canvas2D and WebGPU positions differ at any of the
twenty combinations.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextParity.spec.ts`

### AC-003 — Text quads land on integer device pixels

Every text quad's device-space origin and extent must be integers. Assert at `dpr ∈ {1, 1.5, 3}` and
at non-integer `viewportStartBeat` and `scrollY`, since those are the inputs that make the current
code fractional.

Currently violated at `createWebGpuRenderer.ts:426-427`, feeding a `linear`-filtered sampler
(`:356`). Fractional destinations through a linear filter are the documented cause of the blur:
"If you simply cache a single version of the bitmap and draw it at different subpixel positions with
a GPU, you will get either the exact same result… or linear filtering. Linear filtering will cause a
sub-pixel positioned bitmap to blur further"
(https://rasmusbarr.github.io/blog/subpixelglyph.html).

If sub-pixel horizontal positioning is retained rather than discarded, it must be quantised into a
small fixed set of buckets and baked into the raster, as Warp does — "we split each pixel into 3
equally-sized subpixels, and round the horizontal position to the nearest subpixel"
(https://www.warp.dev/blog/adventures-text-rendering-kerning-glyph-atlases) — and the bucket count
must be asserted as an exact number.

Observation that violates it: a quad emitted with a fractional device-pixel origin.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextSnapping.spec.ts`

### AC-004 — No raster is destroyed while the current frame still references it

Eviction must not destroy an entry acquired since the last `queue.submit`, either by deferring
eviction past submit or by refusing to evict a frame-live entry. The test drives a frame whose
distinct-label count exceeds the cache capacity and asserts that nothing referenced at encode time
has been destroyed.

Mutation that reds it: restore the synchronous destroy at `createClipLabelTextureCache.ts:200-202`.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextAtlas.spec.ts`

### AC-005 — Capacity is sufficient for the visible label count, and overflow is observable

Text capacity must be at least the number of labels the render model can make visible in one frame,
and any overflow must emit a diagnostic a test can observe — not the current silent early return at
`createWebGpuRenderer.ts:407-409`. `MAX_CACHED_LABELS` (256) being half of `MAX_LABELS` (512) is the
specific inversion to remove.

Observation that violates it: a frame that drops a label with nothing recorded anywhere.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextAtlas.spec.ts`

### AC-006 — Rasterisation count over a zoom sweep equals the number of distinct label identities, exactly

Over a 240-frame continuous zoom sweep at fixed DPR with a fixed set of L labels, the number of
rasterisations must equal an exact enumerated number, stated in the test — L if the truncation
decision lands (see Open questions), otherwise L × the enumerated set of width buckets the sweep
crosses.

**It must be an exact equality, not a bound and not a ratio.** A bound re-based onto the last
observed value cannot be exceeded by construction, which is the failure this repo has already
shipped once (`../render-parity-instrumentation/spec.md`).

Observation that violates it: any sweep producing one more or one fewer rasterisation than the
stated number.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextCache.spec.ts`

### AC-007 — The text pass issues a draw-call count independent of label count

Exactly one `draw`/`drawIndexed` and at most one `setBindGroup` on the text pipeline per frame,
whether 1 label or 400 are visible.

Observation that violates it: a second frame with more labels issuing more calls than the first.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextAtlas.spec.ts`

### AC-008 — The raster box comes from ink bounds, not advance width

Box extents must derive from `actualBoundingBoxLeft`, `actualBoundingBoxRight`,
`actualBoundingBoxAscent` and `actualBoundingBoxDescent`, not from `measureText().width`
(`createClipLabelTextureCache.ts:101`) and not from the fixed `ASCENT 10 / DESCENT 4` pair
(`clipLabel.ts:32-38`). Assert with a stubbed metric whose ink exceeds its advance in each of the
four directions, at `dpr ∈ {1, 3}`.

Observation that violates it: a raster narrower or shorter than the ink it must contain.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextRaster.spec.ts`

### AC-009 — A device-pixel-ratio change re-rasterises in both directions without a reload

The renderer must observe DPR changes using the `matchMedia('(resolution: ${dpr}dppx)')` pattern
already used in this codebase at
`src/modules/Arrangement/presentations/views/TimelineMinimap.tsx:213`, re-create the listener on each
change as MDN requires (https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio),
resize the canvas and re-rasterise every visible label. Assert **1 → 2 and 2 → 1**; a criterion tested
only at DPR 1, or only upward, is untested.

Observation that violates it: a label still drawn from its old-DPR raster after the change.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextDpr.spec.ts`

### AC-010 — Every label is rasterised as one whole string, never per code point

The rasteriser must pass the complete string to a single `fillText` call so shaping, bidi, the font
fallback cascade and colour emoji come from the platform's text preparation algorithm
(https://html.spec.whatwg.org/multipage/canvas.html#text-preparation-algorithm). Assert one
`fillText` per label carrying the full string, including for a string containing a grapheme cluster,
an RTL run and an emoji.

Observation that violates it: a label producing more than one `fillText` call, or a call whose
argument is a substring of the label.

Verify with: the future owning test, run as
`pnpm test:run --dir src src/modules/Arrangement/presentations/renderers/__tests__/timelineTextRaster.spec.ts`

### AC-011 — Module boundaries hold

No new cross-module internal imports, no new baseline rows.

Verify with: `pnpm deps:validate`

### AC-012 — Types stay clean in app and test configurations

Verify with: `pnpm typecheck && pnpm typecheck:test`

### AC-013 — Labels are legible and identical between backends at each DPR — eyes required

Load the same project on the same machine under each backend and compare, at
`devicePixelRatio ∈ {1, 1.5, 2, 3}` — the non-1 values are the point; DPR 1 alone proves nothing.
Compare all eight layers. Included in this check: no dark halo or bright fringe around glyphs, which
is what an alpha/premultiplication mismatch between the upload
(`createClipLabelTextureCache.ts:151`) and the pipeline blend (`createWebGpuRenderer.ts:347-348`)
looks like.

Observation that violates it: any layer legible in one backend and not the other, or visibly
different in weight, position or fringing.

Verify with: `manual` — run the app under each backend at each DPR and compare all eight layers side
by side

### AC-014 — No shimmer during scroll or zoom — eyes required

Record a 3-second horizontal scroll drag and a 3-second zoom drag. Glyph edges must stay stable;
labels must not pulse, crawl or breathe. This is the observable consequence of AC-003 and cannot be
established by AC-003 alone.

Observation that violates it: visible per-frame change in glyph edges while the label's own text is
unchanged.

Verify with: `manual` — record a scroll drag and a zoom drag and step through frames

### AC-015 — Non-Latin, RTL and emoji names render correctly and identically — eyes required

Name clips and tracks in Japanese, Simplified Chinese, Korean, Arabic, Hebrew and Devanagari, plus
one emoji and one combining-diacritic string, and compare both backends. Arabic must be joined and
laid out right-to-left; emoji must be in colour; nothing may be box-clipped at the raster edge.
"Renders ASCII" is not "done" — clip and track names are user-supplied.

Observation that violates it: tofu boxes, unjoined Arabic letterforms, LTR-ordered Hebrew,
monochrome or missing emoji, or ink clipped at a texture boundary.

Verify with: `manual` — set the fixture names, screenshot both backends, compare glyph by glyph

## Machine-verifiable versus eyes-required

| Machine-verifiable                            | Eyes-required          |
| --------------------------------------------- | ---------------------- |
| AC-001 … AC-012 (twelve)                       | AC-013, AC-014, AC-015 (three) |

The split is real and not a formality. AC-003 can prove a quad is integer-aligned; only AC-014 can
prove the result does not shimmer. AC-010 can prove the whole string reached `fillText`; only AC-015
can prove the glyphs came out right. Claiming the machine set alone closes this phase would be the
unfalsifiable move.

## Verification commands — confirmed versus unrun

This spec was written in a docs-only worktree with no `node_modules`, so **none of the commands below
were executed here.** What was confirmed is that each one is real:

| Command                                    | Confirmed                                                       | Executed |
| ------------------------------------------ | --------------------------------------------------------------- | -------- |
| `pnpm deps:validate`                        | script exists in `package.json`                                  | no       |
| `pnpm typecheck`, `pnpm typecheck:test`     | scripts exist in `package.json`                                  | no       |
| `pnpm test:run --dir src <path>`            | `test:run` is `vitest run`; the `--dir src` form is used at `../parameter-automation-coverage/spec.md:146` | no |
| the seven `__tests__/timelineText*.spec.ts` paths | **do not exist yet** — they are the future owning tests this phase creates, following the house form used throughout `../hardware-controller-ecosystem/spec.md` | no |
| `manual` verifications                      | require a WebGPU-capable machine and a human                     | no       |

No `Verify with:` line here invokes a script that does not exist. The vitest paths are declared as
future artifacts rather than presented as runnable today, which is the distinction that a previous
spec got wrong.

## Open questions

- [ ] **Condense or truncate?** Labels are currently condensed to fit
      (`clipDrawing.ts:163`, `clipLabel.ts:11-16`). The field standard is fixed size with truncation
      or hiding, sourced above, and it also removes zoom from the cache key entirely. Adopting it is
      a **visible change to how every existing project looks**, so it is an owner call.
      **Recommendation: adopt truncation with an ellipsis and a hide floor, applied in the shared
      layout module so both backends change together.** If the owner declines, AC-006's exact number
      becomes L × the enumerated width buckets and the cache key keeps its width term; nothing else
      in this spec moves. Blocks `status: ready`.
- [ ] (non-blocking) If the atlas allocator in Decision 2 proves larger than this phase, fall back to
      the Canvas2D overlay layer assessed above — it gives parity by construction at the cost of a
      second compositing surface. Proposed trigger: the allocator alone exceeding the phase budget.
- [ ] (non-blocking) `ResizeObserver` with `box: ['device-pixel-content-box']` is the more precise
      backing-store mechanism (https://web.dev/articles/device-pixel-content-box) but is
      Chromium-only. Per ADR 0012 the desktop target runs a WebKit webview, so AC-009 specifies the
      `matchMedia` route, which works on both. Revisit only if `matchMedia` proves insufficient.

## Affected areas

- `src/modules/Arrangement/presentations/renderers/createWebGpuRenderer.ts` — text pipeline, atlas
  binding, instanced text draw, capacity, DPR observation
- `src/modules/Arrangement/presentations/renderers/createClipLabelTextureCache.ts` — generalises from
  clip labels to all eight layers; ink-bounds sizing; eviction safety
- `src/modules/Arrangement/presentations/renderers/clipLabel.ts` — becomes the shared multi-layer
  layout and typography module both backends read
- `src/modules/Arrangement/presentations/renderers/createCanvasRenderer.ts`,
  `clipDrawing.ts` — read layout and typography from the shared module instead of inline literals;
  no behavioural change beyond whatever the truncation decision settles
- `src/modules/Arrangement/presentations/renderers/__tests__/` — seven new specs

## Out-of-scope observations

Found while verifying, with evidence. Not folded in; not fixed here.

1. **The WebGPU renderer draws no take lanes at all.** `createCanvasRenderer.ts:276-321` draws take
   rectangles, borders, names and active comp regions from `takeLaneStore`;
   `createWebGpuRenderer.ts` never imports `takeLaneStore`. Text layer 8 is therefore missing
   because its *geometry* is missing, and AC-001 cannot be satisfied for it without the geometry.
2. **The WebGPU renderer draws no variation lanes.** `createCanvasRenderer.ts:221-249` draws lane
   backgrounds, labels, clips and separators from `track.variationLanes`
   (`TimelineRenderModel.ts:30-32`); `createWebGpuRenderer.ts` never reads that field. Same
   consequence for layer 7.
3. **The WebGPU renderer has no folder-track case.** `createCanvasRenderer.ts:144-199` gives folder
   tracks a 26 px row, an amber accent and an uppercased name; the WebGPU track loop
   (`createWebGpuRenderer.ts:454-467`) uses `track.height` for every track and has no `kind` branch.
   Folder rows are the wrong height on WebGPU today, independent of text.
4. **The WebGPU renderer draws no loop region.** `createCanvasRenderer.ts:323-346` fills and
   dash-strokes the loop range from `transportStore`; there is no equivalent in the WebGPU renderer.
5. **`getPreferredRendererBackend()` has no override.** `RendererBackend.ts:10-12` is presence-only,
   and nothing in `src/` reads a preference. There is no way for a user hitting a WebGPU defect to
   choose Canvas2D, and no way for a reviewer to A/B the two without editing source.
   `../webgpu-automation-rendering/spec.md` AC-005 assumes "disable WebGPU via flag"; no such flag
   exists.
6. **No end-to-end test exercises WebGPU.** No file under `tests/e2e/` mentions WebGPU or
   `navigator.gpu`, so nothing in the suite has ever observed the backend the majority of users get.
