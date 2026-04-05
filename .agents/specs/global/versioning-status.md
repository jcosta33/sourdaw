# Sourdaw CRDT Superpowers — Status and Remaining Tasks

## 1. Objective

Expand Sourdaw’s current AutomergeStorage architecture to add single-player local-first capabilities.

**Missing / Remaining Goals:**

- Semantic history inspection panel (`src/modules/CrdtHistory`)
- Safe non-linear compensating undo workflows (`revertSemanticAction`)
- Gradual migration toward lazy-loaded child documents (`crdtLazyLoad.ts`)

---

## 2. Remaining Feature Specification

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

## 3. Implementation Divergences & Improvements (Completed)

The following CRDT items were implemented differently than originally specified in the full versioning implementation guide, resulting in vastly cleaner architecture:

- **Thread-Local Semantic Context:** The spec suggested wrapping every single individual `store.set()` call within the application with a new `applySemanticChange` helper. This would have required a massive, error-prone codebase rewrite. Instead, the implementation (`semanticChangeContext.ts`) introduced a "thread-local" global context (`getSemanticContext`). Top-level app actions simply set the semantic context before execution, and `AutomergeStorage` implicitly reads it during its write-to-CRDT cycle. This achieves semantic history tracking with nearly zero boilerplate.
- **Hot-Swapping Branch Document Roots:** The spec suggested that a branch switch would require telling the UI, audio engine, and local storage to track and route to different target doc IDs (such as changing the repository identifier keys entirely). Instead, the implementation (`crdtBranching.ts`) seamlessly hot-swaps the underlying Automerge `Doc` pointer _behind_ the fixed `DOC_PREFIX_ROOT` identifier inside the repository. This is a significantly better approach because it isolates all branching complexity to the branching module itself—the rest of the app remains blissfully unaware that a branch swap occurred, treating it as a standard hydration/projection event under the same predictable key.

---

## 4. Worse Implementations & Anti-Patterns (Needs Fixing)

The following items were implemented in a way that is actively worse than what the specification demanded. These should be considered high-priority targets for refactoring:

- **Brute-Force Trial Merge for Lineage Detection:** The spec (`versioning.md`) explicitly warned: _"Merge detection should be based on shared history / document identity. Do not implement 'merge(docA, docB) and hoping'."_ However, the implementation in `src/modules/CrdtDocument/useCases/crdtMerge.ts` (`detectImportDecision`) does exactly what was forbidden. It loads the incoming document bytes, _fully clones_ the existing local document, executes a complete in-memory `Automerge.merge()`, and then counts all changes to guess if they share history. This is a massive anti-pattern that creates O(N) overhead over the entire document change graph and uses enormous memory, instead of simply checking intersecting heads or bundle metadata as intended.
- **Incomplete Incremental Auto-Save:** The current auto-save implementation (`startCrdtAutoSave.ts` / `crdtProjectLifecycle.ts`) relies on `automergeRepository.saveDocIncremental(DOC_PREFIX_ROOT)`. This strictly hardcodes the incremental save operation to ONLY the root document. Since the codebase is meant to be migrating toward a multi-document branch structure where child branches have different actual `DocId` properties under the hood, this rigid design completely ignores other documents and branch structures, leaving them unprotected by the auto-save cadence.
