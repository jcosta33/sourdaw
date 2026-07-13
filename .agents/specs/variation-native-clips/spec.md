---
type: spec
id: SPEC-variation-native-clips
title: Variation-native clips and branches
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Variation-native clips and branches

## Intent

Make alternatives a first-class session structure: any clip or arrangement section
can hold structured variants that the user auditions in place, compares, promotes,
merges, and archives — so branch-heavy work no longer degrades into duplicate
tracks, muted lanes, and "final_v12" filenames. Project-level CRDT branching,
track alternatives, and linked clips already exist in isolation; this unifies them
into a clip-level variants affordance.

## Non-goals

- Project-wide branching (already shipped via the CRDT document module).
- Linked-clip pattern instances (a separate, existing concept that propagates edits).
- AI generation itself — variants are the destination for AI/collaborator output,
  not the generator (see `ai-trust-modes`).
- A heavy "variation tree" panel for whole-song arrangements — section/clip scope first.

## Requirements

### AC-001 — Every clip exposes a variant affordance

When a clip belongs to a variant group, the timeline must render a variant
indicator (count badge) on that clip.

Verify with: `manual` — open a clip with 3 variants and confirm the badge shows the count and lists siblings

### AC-002 — Create a variant without duplicating track structure

When the user creates a variant of a clip, the system must snapshot the clip's
content into a new sibling sharing a variant-group identity, without adding a track
or alternative lane the user did not request.

Verify with: `pnpm test:run -- createVariant`

### AC-003 — Audition a variant in place

When the user auditions a variant, playback must use that variant's content at the
clip's timeline position without committing it, and restore the active variant when
audition ends.

Verify with: `pnpm test:run -- auditionVariant`

### AC-004 — Promote and archive preserve history

When the user promotes an archived variant, it must move to the active timeline
position and the previously active variant must be retained as attached history
(not deleted).

Verify with: `pnpm test:run -- promoteVariant`

### AC-005 — Human-readable diff summary between two variants

When the user compares two variants, the system must produce a diff summary in
human terms (notes changed, timing changed, sound changed, mix changed), not a
binary delta.

Verify with: `pnpm test:run -- compareVariants`

### AC-006 — Selective attribute merge

When the user merges two variants, the system must let them take named attributes
from each (e.g. phrasing from one, timbral treatment from another) into a single result.

Verify with: `pnpm test:run -- mergeVariantAttributes`

### AC-007 — Lineage metadata travels with every variant

Every variant must carry lineage metadata (original / forked / derived / merged,
source, created-at) that survives save/load and CRDT sync.

Verify with: `pnpm test:run -- variantLineage`

### AC-008 — Variants are siblings, not hidden internal states

When a clip belongs to a variant group, its variants must appear as siblings,
never as hidden internal states.

Verify with: `manual` — open a clip with 3 variants and confirm they are listed as siblings, not buried as internal states

### AC-009 — Stochastic or large transforms default to a branch, not in-place replacement

When a stochastic generator or a large transform produces output targeting a clip,
the system must default to writing that output as a new variant (branch output),
never silently replacing the clip's active content in place.

Verify with: `pnpm test:run -- generationDefaultsToBranch`

## Open questions

- [ ] (non-blocking) Should section-level variants reuse the same group identity as
  clip-level, or carry a distinct section-scoped group? Default: clip scope ships first.
- [ ] (non-blocking) Where do archived variants persist — the existing track-alternative
  store, or a dedicated variant archive? Default: reuse the existing alternative store.
- [ ] (deferred-gap from intake/implementation-gaps.md) Clip aliases & automation clips
  (gap §5.3): today only basic "Figma-style" linked clips exist. Three pieces of scope
  remain undecided for how variation-native clips relate to the linked-clip system:
  (a) elevate **automation clips** to first-class reusable objects (not just lane data
  bound to one clip); (b) add **variation lanes** — alternate clip realizations selectable
  per arrangement region, framed for chorus/fill switching; (c) add **project-wide groove
  templates** that apply over linked clips. Open whether variation lanes are the same
  primitive as this spec's variant groups or a distinct arrangement-region construct, and
  whether groove templates compose with variants or sit on the linked-clip layer.
  Non-blocking: clip/section variant groups ship first; automation-clip reuse, variation
  lanes, and groove templates are forward scope.

## Affected areas

- `src/modules/Arrangement/` (Clip model, variants use cases, clip rendering)
- `src/modules/MIDI/` (note hot-swap on audition)
- `src/modules/CrdtDocument/` (sync of new optional clip fields)

## Dropped from sources

- The full future-spec "Variation Stack" panel with side-by-side compare for whole-song
  arrangements — deferred; clip/section variants ship first to avoid a heavy panel.
- Generated-variant engine-binding storage — folded into `engine-visibility-swap`.
