# CRDT Enhancements

## Context

Sourdaw already has an Automerge-backed `AutomergeStorage` module, plus semantic change context (`semanticChangeContext.ts`) and branch hot-swap (`crdtBranching.ts`). This spec defines the forward-looking CRDT work that extends that foundation with single-player local-first capabilities: semantic history inspection, compensating undo, and multi-document lazy loading.

This spec is deliberately scoped to enhancements over the existing CRDT substrate. The reference architecture for the underlying Automerge storage layer lives in the codebase, not in research.

## Goal

After implementation, Sourdaw offers a semantic history panel, safe non-linear compensating undo, and demand-loaded child CRDT documents — without blocking the audio thread and without replacing the existing single-root storage model wholesale.

## Scope

**In scope:**

- Semantic history inspection panel (`src/modules/CrdtHistory`).
- Non-linear compensating undo (`revertSemanticAction`).
- Multi-document architecture with lazy child-doc loading (`crdtLazyLoad.ts`).
- Resolving two known anti-patterns called out in §5 (brute-force trial merge; incremental auto-save bound to root only).

**Out of scope:**

- Multi-user real-time collaboration (separate spec; see `../consolidated/implementation-gaps.md` §3, §9).
- A completely new storage engine; we build on Automerge/AutomergeStorage.
- UI theming or keyboard-shortcut design for the history panel beyond what the general UX system defines.

---

## Remaining feature specification

### Feature 1: Semantic History and Non-Linear Compensating Undo

**Goal:**
Allow users to inspect history semantically and revert a specific earlier intent without rewinding unrelated later work.

**What ships:**

- **History panel:** Create a UI showing message, actor, timestamp, affected object.
- **Compensating undo:** Apply a new semantic inverse change at the current head. Do not attempt universal automatic inversion of arbitrary historical low-level Automerge changes.

**Implementation directives:**

- Add a local semantic history journal keyed by document ID + change hash.
- Build history browsing on real heads/history using Automerge history APIs.
- Create `src/modules/CrdtHistory/useCases/revertSemanticAction.ts` to compute and apply inverse mutations.

### Feature 2: Multi-Document Architecture and Lazy Loading

**Goal:**
Move from one giant root document toward a root+child-doc layout that reduces startup cost and memory pressure.

**What ships:**

- **Root document stays small:** Keep project metadata, track registry, and routing in the root doc.
- **Child docs for heavy sections:** Move track bodies, large MIDI clips, and heavy automation lanes into child docs over time.
- **Demand-driven loading:** Load child docs only when visible in viewport, selected, or needed for playback prefetch.

**Implementation directives:**

- Refactor target order: Phase A (track docs), Phase B (MIDI clips, automation), Phase C (plugin states).
- Create a document loader service: `src/modules/CrdtDocument/useCases/crdtLazyLoad.ts`.
- Implement an LRU-like cache policy for inactive docs.
- **Audio engine rule:** The projection/cache layer must prepare canonical engine-ready snapshots ahead of time to avoid blocking the audio callback.

---

## Acceptance criteria

- [ ] Semantic history panel renders message, actor, timestamp, and affected object for every semantic change.
- [ ] `revertSemanticAction(changeId)` applies a compensating semantic change at `HEAD` that inverts the target intent, without rewinding unrelated later work.
- [ ] Child CRDT documents load on demand (viewport, selection, or playback prefetch) and unload under an LRU policy when idle.
- [ ] The audio engine never blocks on a child-doc fetch — projection layer prepares engine-ready snapshots ahead of time.
- [ ] `crdtMerge.ts` lineage detection uses shared heads / bundle metadata, not full in-memory trial merge (see §5).
- [ ] Incremental auto-save writes all active CRDT documents, not only `DOC_PREFIX_ROOT` (see §5).

## Implementation notes

- Follow the existing `semanticChangeContext` thread-local pattern; do not introduce a parallel "wrap every store.set" helper.
- Refactor order for multi-doc: Phase A (track docs), Phase B (MIDI clips + automation lanes), Phase C (plugin states).
- For merge lineage detection, inspect intersecting heads or bundle metadata before any merge.

## Historical context: divergences from the original CRDT guide (Completed)

The following CRDT items were implemented differently than originally specified in the full versioning implementation guide, resulting in vastly cleaner architecture:

- **Thread-Local Semantic Context:** The spec suggested wrapping every single individual `store.set()` call within the application with a new `applySemanticChange` helper. This would have required a massive, error-prone codebase rewrite. Instead, the implementation (`semanticChangeContext.ts`) introduced a "thread-local" global context (`getSemanticContext`). Top-level app actions simply set the semantic context before execution, and `AutomergeStorage` implicitly reads it during its write-to-CRDT cycle. This achieves semantic history tracking with nearly zero boilerplate.
- **Hot-Swapping Branch Document Roots:** The spec suggested that a branch switch would require telling the UI, audio engine, and local storage to track and route to different target doc IDs (such as changing the repository identifier keys entirely). Instead, the implementation (`crdtBranching.ts`) seamlessly hot-swaps the underlying Automerge `Doc` pointer _behind_ the fixed `DOC_PREFIX_ROOT` identifier inside the repository. This is a significantly better approach because it isolates all branching complexity to the branching module itself—the rest of the app remains blissfully unaware that a branch swap occurred, treating it as a standard hydration/projection event under the same predictable key.

---

## Known anti-patterns to resolve (§5)

The following items were implemented in a way that is actively worse than what the specification demanded. These should be considered high-priority targets for refactoring:

- **Brute-Force Trial Merge for Lineage Detection:** The spec (`versioning.md`) explicitly warned: _"Merge detection should be based on shared history / document identity. Do not implement 'merge(docA, docB) and hoping'."_ However, the implementation in `src/modules/CrdtDocument/useCases/crdtMerge.ts` (`detectImportDecision`) does exactly what was forbidden. It loads the incoming document bytes, _fully clones_ the existing local document, executes a complete in-memory `Automerge.merge()`, and then counts all changes to guess if they share history. This is a massive anti-pattern that creates O(N) overhead over the entire document change graph and uses enormous memory, instead of simply checking intersecting heads or bundle metadata as intended.
- **Incomplete Incremental Auto-Save:** The current auto-save implementation (`startCrdtAutoSave.ts` / `crdtProjectLifecycle.ts`) relies on `automergeRepository.saveDocIncremental(DOC_PREFIX_ROOT)`. This strictly hardcodes the incremental save operation to ONLY the root document. Since the codebase is meant to be migrating toward a multi-document branch structure where child branches have different actual `DocId` properties under the hood, this rigid design completely ignores other documents and branch structures, leaving them unprotected by the auto-save cadence.

---

## Open questions

- [ ] **[MINOR]** Maximum size of the semantic history journal before it is pruned or archived. Proposal: cap at 10 000 entries per document, archive oldest to a sidecar ledger.
- [ ] **[MINOR]** Exact LRU eviction thresholds for child-doc cache (entries vs bytes). Needs measurement on a 500-track project.

## Tradeoffs and risks

- **Trade-off — thread-local semantic context:** Elegant and low-boilerplate, but requires strict discipline at action entry points; easy to forget in a new code path. Mitigation: lint rule or type-level wrapper for top-level app actions.
- **Risk — child-doc projection stalling audio:** If the projection layer falls behind, playback could dropout. Mitigation: pre-load active window + look-ahead ahead of the playhead by ≥ 2 s.
- **Risk — non-linear undo semantics:** Users may expect linear undo muscle memory. Mitigation: keep a linear "undo last action" stack in parallel with the semantic history for everyday use; semantic revert is an explicit action from the history panel.
