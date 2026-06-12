# SoundLibrary module audit

## Scope

This audit covers `src/modules/SoundLibrary/` in full — every file in
`stores/`, `models/`, `errors/`, `events/`, `services/`, `useCases/`
(including the `sampleDatabase/` subfolder), and all `__tests__/`
folders. It explicitly excludes upstream callers (`Arrangement`,
`Command`, `AudioEngine`, etc.) except where they are directly imported
from this module.

It is an adversarial review: bugs, race/staleness conditions, dead
abstractions, lazy/broken tests, accessibility, AGENTS.md violations,
and DSP/UX hazards.

Related spec: none on disk.

---

## Goal

A correctness-first, well-bounded sample library module:

- A real, observable sample database backed by an `IndexedDB` (or Tauri
  filesystem) repository — not an in-memory array that vanishes on
  reload.
- A real perceptual fingerprint that supports content-based similarity
  (or the feature is removed and the field is renamed to `pathHash`).
- A coherent module barrel (`src/modules/SoundLibrary/index.ts`) that
  exposes only the cross-module public surface; intra-module imports go
  through relative paths.
- Use cases that orchestrate repositories and validate input;
  presentation surfaces that subscribe to the store via `useStore`.
- Handlers that bridge `AppAction` to use-case calls — the module owns
  its own handlers, not `Arrangement`.
- Tests that assert behaviour (filter results, sort order, similarity
  scoring, store mutations) — not "the function exists".
- AGENTS.md hard rules: no `any`, no namespace imports, no positional
  multi-arg signatures, no self-barrel imports inside the module, one
  function per `useCases/` file, single-responsibility services.

---

## Relevant code paths

- `src/modules/SoundLibrary/` (no root `index.ts` — see issue #1)
- `src/modules/SoundLibrary/stores/index.ts` (`// no public stores`)
- `src/modules/SoundLibrary/stores/sampleDatabaseStore.ts`
- `src/modules/SoundLibrary/models/SampleEntry.ts`
- `src/modules/SoundLibrary/errors/SampleDatabaseError.ts`
- `src/modules/SoundLibrary/events/index.ts` (`// no public events`)
- `src/modules/SoundLibrary/services/sampleTaggingHelpers.ts`
- `src/modules/SoundLibrary/useCases/index.ts` (re-exports `searchSamples` only)
- `src/modules/SoundLibrary/useCases/sampleDatabase/{addSample, addUserTag, findSimilarSamples, getAllTags, getFilteredSamples, getSampleCount, rateSample, recordUsage, removeSample, searchSamples, setCategoryFilter, setSortBy, setTagFilter, toggleFavorite, toggleFavoritesOnly}.ts`
- `src/modules/SoundLibrary/useCases/sampleDatabase/__tests__/*.spec.ts`
- `src/modules/SoundLibrary/services/__tests__/sampleTaggingHelpers.spec.ts`
- `src/modules/SoundLibrary/stores/__tests__/sampleDatabaseStore.spec.ts`
- `src/modules/SoundLibrary/errors/__tests__/SampleDatabaseError.spec.ts`

External consumer:

- `src/modules/Arrangement/handlers/batchFeature/handleSearchSamples.ts:1`
  (the only cross-module caller — for `searchSamples` only).

---

## Current behavior

**Store.** A single `sampleDatabaseStore` (`stores/sampleDatabaseStore.ts:14`)
holds `samples: SampleEntry[]`, `searchQuery`, `activeFilters`,
`categoryFilter`, `sortBy`, `sortDirection`, `favoritesOnly`. State is
purely in-memory; nothing persists across reloads.

**No repository.** There is no `repositories/` directory at all. There
is no I/O — no `IndexedDB`, no Tauri-side persistence, no audio decode
to compute fingerprints. The module's name implies a sound _library_;
the implementation is a session-scoped in-memory list.

**Models.** `SampleEntry` (`models/SampleEntry.ts:15`) is a flat record
with audio metadata fields (`durationSec`, `sampleRate`, `bitDepth`,
`channels`, `fileSize`, `bpm`, `key`), `tags: SampleTag[]`, `rating`,
`favorite`, `color`, `fingerprint`, and timestamps. Fields like
`fileSize` and `sampleRate` are typed but never populated — `addSample`
takes them as defaultable args (`= 44100`, `= 16`, `= 2`, `= 0`) with no
validation.

**Services.** `sampleTaggingHelpers.ts` exports `AUTO_TAG_RULES`
(regex-based mapping `name → tags + category`), `autoTagSample(name,
path)`, `generatePathHash(name, path)` (djb2-style hash of `name:path`,
returns `path-<base36>`), and `getNextSampleId()` (`sample-${crypto.randomUUID()}`).

**Use cases (16 total).** Fifteen files in `useCases/sampleDatabase/`
each performing a state mutation against the store (`addSample`,
`removeSample`, `addUserTag`, `rateSample`, `toggleFavorite`,
`toggleFavoritesOnly`, `searchSamples`, `setCategoryFilter`,
`setTagFilter`, `setSortBy`, `recordUsage`) or a query
(`getFilteredSamples`, `findSimilarSamples`, `getAllTags`,
`getSampleCount`). All sixteen use cases reach back into the module via
absolute `#/modules/SoundLibrary/...` paths — every single file
violates AGENTS.md "Same module — relative imports".

**`useCases/index.ts`** re-exports only `searchSamples`. The other 14
use cases are **not** exposed to other modules. The only cross-module
consumer is `Arrangement` calling `searchSamples`.

**Memoization.** `getFilteredSamples` (`getFilteredSamples.ts:18`)
keeps a module-level `memo: MemoEntry | null` keyed by `(stateRef,
fingerprint)`. The fingerprint is built from filter/sort fields only —
not from `state.samples` identity. If the samples array changes but the
filter fields stay the same, the memo stalely returns the previous
result.

**Tests.** Thirty-eight test files. Fifteen of the `useCases/`
specs are `import * as subject from '../X'; expect(subject.X).toBeDefined();
expect(typeof subject.X === 'function' || === 'object').toBe(true);`.
That is the entire body of every `useCases/*.spec.ts` except the
opaquely-distinguished `searchSamples`. They cover nothing.

The store spec (`stores/__tests__/sampleDatabaseStore.spec.ts:29`)
constructs a `sample` literal with `category: 'kicks'` and missing 90%
of `SampleEntry`'s required fields, then `update`s the store with it.
This passes only because the spec imports the store directly and
`createStore` does no runtime validation — but `category` is **not** a
field of `SampleEntry` at all, and the store's typed shape is silently
violated.

---

## Findings

1. **No module barrel `index.ts` at `src/modules/SoundLibrary/`.** Every
   other audited module has one. The only cross-module consumer
   (`handleSearchSamples.ts:1`) imports from `#/modules/SoundLibrary/useCases`
   — which works only because that path resolves to the subdirectory's
   `index.ts`. AGENTS.md "Cross-module imports MUST only target the
   destination module's root `index.ts`" — since no root `index.ts`
   exists, every external reference deep-imports into the module.

2. **No repository, no persistence — the entire module is in-memory.**
   `SampleEntry`'s `path`, `format`, audio metadata, etc. all suggest a
   real disk/filesystem-backed library. There is no `repositories/`
   directory, no I/O code, and the store starts empty on every reload.
   `addSample` takes pre-decoded `durationSec` / `sampleRate` /
   `bitDepth` / `channels` / `fileSize` as positional args with bogus
   defaults (`44100`, `16`, `2`, `0`) — there is no caller anywhere in
   the codebase that calls `addSample`, so these defaults are never
   exercised.

3. **`fingerprint` is a path hash, not an audio fingerprint.**
   `sampleTaggingHelpers.ts:62` (`generatePathHash`) hashes `name:path`
   only. The JSDoc explicitly admits this is not perceptual and that
   "a real perceptual hash needs to read the decoded audio". Yet
   `findSimilarSamples` (`findSimilarSamples.ts:23`) uses Jaccard
   similarity on **tags** — never on the fingerprint at all. The
   `fingerprint` field is dead data: the field exists, is computed and
   stored, and no use case reads it. Renaming to `pathHash` and
   removing the misleading JSDoc references would be the minimum.

4. **Almost no use case is exposed to other modules.** `useCases/index.ts`
   re-exports a single function (`searchSamples`). Fifteen other use
   cases — all the actual library operations (`addSample`,
   `findSimilarSamples`, `getFilteredSamples`, `setCategoryFilter`,
   `toggleFavorite`, etc.) — have no presentation, no handler, no
   AppAction binding, no UI. They are dead code that ships with tests
   that assert nothing. The "sample library" feature does not exist
   end-to-end.

5. **All 15 use case test files are `expect(subject.X).toBeDefined()`
   placeholders.** AGENTS.md "TypeScript — soundness: Tests: Do not
   stop at 'defined' / 'truthy' / generic `toBeTypeOf('object')`".
   Every spec also uses a forbidden namespace import (`import * as
   subject from '../X'`) — AGENTS.md "Imports: Never use namespace
   imports". The pattern `expect(t === 'function' || t === 'object')`
   accepts an exported `null` or any record literal as a "passing
   test". These tests are anti-coverage.

6. **`stores/__tests__/sampleDatabaseStore.spec.ts:29` constructs an
   illegal `SampleEntry` literal.** It uses a non-existent `category`
   field and omits all 20 required fields (`format`, `durationSec`,
   `sampleRate`, `bitDepth`, `channels`, `fileSize`, `bpm`, `key`,
   `rating`, `color`, `fingerprint`, `addedAt`, `lastUsedAt`,
   `useCount`). It compiles only because the test code spreads it into
   a partial state via `update((s) => ({ ...s!, samples: [sample] }))`
   — the `samples` array's element type is widened by inference rather
   than checked against `SampleEntry`. This test would fail
   immediately under stricter inference; it is a latent type lie.

7. **`getFilteredSamples` memo can return stale data.**
   `getFilteredSamples.ts:29-37` builds the memo fingerprint from
   `searchQuery`, `activeFilters`, `categoryFilter`, `favoritesOnly`,
   `sortBy`, `sortDirection`. It keys the cache on `state` identity
   _and_ that fingerprint — but `addSample`/`removeSample`/
   `rateSample`/`toggleFavorite`/etc. all `set({ ...state, samples: ... })`
   which produces a new state object reference, so the identity check
   _does_ catch sample changes. Confusing-but-correct in the current
   implementation. However, if any future caller mutates `samples`
   in-place (e.g. via `update` with `Object.assign`), the memo would
   silently serve stale results. The fingerprint should include
   `state.samples.length` or a samples-version counter as a defensive
   invariant, otherwise this is a footgun waiting to fire.

8. **`findSimilarSamples` similarity ignores BPM, key, format, and
   audio fingerprint.** `findSimilarSamples.ts:23` computes Jaccard
   similarity over **tag names only**. Two samples in the same
   category but with different keys/BPMs/formats score identically;
   two samples sharing the auto-tag "drum" but in different categories
   score the same as two samples sharing all five auto-tags. Given
   that auto-tags are produced by a small fixed set of regex rules
   (~16-20 distinct tag names exist in the entire system), Jaccard
   over this very low-cardinality space is information-poor. A real
   "similar" feature would weight `bpm` / `key` / `category` and
   factor in audio fingerprint distance; today this is theatre.

9. **`findSimilarSamples` allocates `Int32Array(samples.length)` and
   `Float64Array(samples.length)` per call** even for very small
   libraries. `findSimilarSamples.ts:30-31`. The comment claims
   "single-pass scoring … no per-sample wrapper objects" but for a
   typical library of 50-200 samples, ordinary `Array<{i,score}>` and
   `.sort()` would be faster than typed-array allocation + index
   permutation sort. Premature optimisation.

10. **`getFilteredSamples` allocates a fresh array on every cache miss
    AND fresh `catTags` array on every category-filter pass.**
    `getFilteredSamples.ts:62`: `AUTO_TAG_RULES.filter(...).flatMap(...)`
    is recomputed for every call where `categoryFilter` is set, even
    though `AUTO_TAG_RULES` is module-level constant. Lift to a
    precomputed `Map<SampleCategory, string[]>`.

11. **`searchSamples`, `setTagFilter`, `setCategoryFilter`,
    `setSortBy`, `toggleFavoritesOnly` invalidate `getFilteredSamples`
    memo only by changing the state identity.** This works _today_
    because every setter does a full `set({ ...state, ... })`. Coupling
    the memo invariant to "every setter must return a new state
    reference" is fragile; if a future setter ever uses `update((s) =>
    s)` (no-op short-circuit) the memo would persist incorrectly. No
    test covers the invariant.

12. **All 16 use cases use `#/modules/SoundLibrary/...` self-imports.**
    AGENTS.md: "Files under `src/modules/<Name>/` MUST NOT import from
    `#/modules/<Name>` (their own barrel). Use **relative** paths."
    Every single use case file violates this rule
    (`addSample.ts:1-4`, `addUserTag.ts:1`, `findSimilarSamples.ts:1-2`,
    `getAllTags.ts:1`, `getFilteredSamples.ts:1-3`,
    `getSampleCount.ts:1`, `rateSample.ts:1`, `recordUsage.ts:1`,
    `removeSample.ts:1`, `searchSamples.ts:1`,
    `setCategoryFilter.ts:1-2`, `setSortBy.ts:1-2`, `setTagFilter.ts:1`,
    `toggleFavorite.ts:1`, `toggleFavoritesOnly.ts:1`). Strictly
    speaking these are deep imports into private subpaths
    (`/stores/sampleDatabaseStore`, `/models/SampleEntry`,
    `/services/sampleTaggingHelpers`, `/errors/SampleDatabaseError`),
    not the root barrel — but they are still cross-module-style alias
    imports inside the same module. Should be relative paths
    (`../../stores/sampleDatabaseStore`, etc.).

13. **`addSample` takes 8 positional args.** `addSample.ts:6-15`:
    `addSample(path, name, format, durationSec, sampleRate = 44100,
    bitDepth = 16, channels = 2, fileSize = 0)`. AGENTS.md "Functions
    with more than one parameter take a single object param. … the
    input type is named `FunctionNameInput`". Same violation in
    `setSortBy.ts:4` (two positional args), `addUserTag.ts:3` (two
    positional args), `rateSample.ts:3` (two positional args),
    `findSimilarSamples.ts:12` (two positional args), `recordUsage.ts:3`
    (one — fine). The defaults on `addSample` (`44100`, `16`, `2`, `0`)
    are hazardous — they silently accept a malformed call site.

14. **`addSample` returns the inserted entry but `useCases/index.ts`
    does not export it.** `addSample.ts:6` is unused by the rest of
    the codebase (no caller imports it). The unused return type is
    fine, but the entire function being unreachable is dead-code.

15. **`stores/index.ts` is `// no public stores`, `events/index.ts` is
    `// no public events`** — both are empty placeholder files. If
    nothing is exported, the files should not exist. Worse, the
    convention sets up future readers to expect public stores/events
    later, when the actual contract today is "this module has no
    public surface beyond `searchSamples`".

16. **No handlers folder.** AGENTS.md specifies `handlers/` as the
    location for `AppAction → ActionHandler` maps. The single
    SoundLibrary-related handler
    (`Arrangement/handlers/batchFeature/handleSearchSamples.ts`) lives
    in `Arrangement` — wrong module ownership. The `Arrangement`
    barrel pulls SoundLibrary's `searchSamples` and wraps it; if/when
    SoundLibrary needs more handlers (`addSampleAction`,
    `rateSampleAction`, `toggleFavoriteAction`), they will all need to
    live in the wrong module. Should be `SoundLibrary/handlers/`.

17. **`addSample` throws `createSampleDatabaseError` if `state` is
    null, but every other use case silently `return`s.**
    `addSample.ts:18` is the lone "throw on missing state" path; the
    other 14 mutators do `if (!state) return;`. The contract is
    inconsistent: a UI calling `rateSample` against an uninitialised
    store gets a no-op; calling `addSample` gets a thrown
    `SampleDatabaseError`. Memory: the user feedback rule "Fix all
    issues from reviews" applies — pick one (probably throw on
    `addSample`-like construction; silent no-op on metadata mutators
    seems also wrong, prefer throwing across the board).

18. **`addUserTag` does not deduplicate.** `addUserTag.ts:13-15`
    appends `{ name: tagName, source: 'user', confidence: 1 }`
    unconditionally. If a user double-clicks "add tag", the entry
    holds two copies of the same tag, both will be matched by
    `getFilteredSamples`'s category filter, and `getAllTags` will
    surface the duplicate (saved by `Set`). The contract should be
    "no-op if tag already present, with a `notifyUser` saying so".

19. **`addUserTag` accepts an empty/whitespace tag name.**
    `addUserTag.ts:3` does no validation. `''` and `'   '` are
    accepted. Combined with #18, the user can spam empty tags onto an
    entry indefinitely.

20. **`rateSample` clamps to `[0, 5]` but accepts non-integer and
    `NaN`.** `rateSample.ts:10`: `Math.max(0, Math.min(5, rating))`.
    `Math.min(5, NaN) === NaN`, then `Math.max(0, NaN) === NaN`. The
    sample's `rating` becomes `NaN`. There is no validation that
    `rating` is a finite number. Same use case is also a positional
    two-arg signature (#13).

21. **`setSortBy` direction toggle is non-obvious.**
    `setSortBy.ts:12`: if no `direction` is passed and the current
    `sortBy` matches the new one, the direction toggles. Otherwise it
    resets to `'asc'`. This is a UX shorthand often expected, but the
    function name (`setSortBy`) does not advertise the toggle
    behaviour. The behavior is not tested. A user calling
    `setSortBy('name')` repeatedly will see direction flip — possibly
    fine, but document or rename.

22. **`getAllTags` recomputes the full tag set on every call.**
    `getAllTags.ts:8-15`: O(N×T) per call. Called from sample-browser
    UIs, this churns. Should be memoised against `state.samples`
    identity (same pattern as `getFilteredSamples`).

23. **`recordUsage` always allocates a full new samples array even
    when `sampleId` is not in the store.** `recordUsage.ts:10`:
    `state.samples.map(s => s.id === sampleId ? { ... } : s)` builds a
    new array regardless. If `sampleId` does not exist, every
    sample's reference is preserved but the array is rewritten — the
    store fires a change event, every subscriber re-renders, no data
    actually changed. Same pattern in `toggleFavorite.ts:10`,
    `addUserTag.ts:10`, `rateSample.ts:10`.

24. **`AUTO_TAG_RULES` is a module-mutable `let`-able array.**
    `sampleTaggingHelpers.ts:8`: `export const AUTO_TAG_RULES: Array<...>
= [...]`. The const reference is sealed but the array is mutable —
    callers can `.push()` new rules, polluting global state. Should
    be `as const` and the type narrowed to `readonly`.

25. **Auto-tag patterns are over-eager and case-blind.**
    `sampleTaggingHelpers.ts`: regex `/loop|bpm/i` matches any file
    with "bpm" in the name regardless of context (e.g.
    `melody_120bpm.wav` becomes a "loop"). `/perc/i` matches
    "percussion", "perception", "percent". `/string/i` matches "g-string"
    (a guitar). False positives are rife — the auto-tagger pretends
    to know more than it does. The `confidence: 0.8` value is a
    magic number with no calibration.

26. **`autoTagSample` returns `category` but `addSample` discards it.**
    `addSample.ts:21`: `const { tags } = autoTagSample(name, path);` —
    only destructures `tags`. The detected `category` is computed and
    thrown away. Combined with the absence of a `category` field on
    `SampleEntry`, the auto-tagger's primary signal is unused. (The
    bogus `category: 'kicks'` field in the broken store test (#6) is
    where this confusion bites.)

27. **`generatePathHash` is collision-prone for short strings.** djb2
    hash with `Math.abs` and base36 encoding on 32-bit JS ints gives
    ~4.3 billion buckets, but with the `name:path` concatenation
    convention there's no cryptographic resistance. For a sample
    library of < 10 000 entries the collision probability is ~10⁻⁵,
    so this is theoretical. But the function is sold as an "audio
    fingerprint" (`SampleEntry.fingerprint` JSDoc says "Audio
    fingerprint hash for similarity detection") — it is neither audio
    nor for similarity.

28. **`SampleEntry` is over-modelled.** Fields `bitDepth`, `fileSize`,
    `color`, `lastUsedAt`, `useCount`, `bpm`, `key`, `fingerprint` are
    all defined in the type but none are populated by any code path
    (`addSample` defaults them to constants and there is no
    edit/import/decode pipeline). They are documentation-as-types,
    not data. Either implement the population paths or shrink the
    model.

29. **No store is exported as the public surface.** Other modules
    cannot subscribe to `sampleDatabaseStore` to render a sample
    browser without breaking module boundaries (and would have to
    deep-import `#/modules/SoundLibrary/stores/sampleDatabaseStore`).
    A presentations layer that lists samples does not exist; if it
    did, it would require either a `presentations/views/`
    sub-component or a public store re-export.

30. **No `presentations/`** — the module has no view components or
    hooks, despite owning user-facing concepts (sample browser,
    favorites, search). The "sample library" UI either does not
    exist anywhere or lives in another module without proper
    contract.

31. **`models/SampleEntry.ts` exports `SampleDatabaseState` (a store
    shape, not a domain model).** AGENTS.md "Models (`models/`) are
    strictly private to their owning module" — fine, but
    `SampleDatabaseState` is the store's _runtime_ shape, not a
    domain model. Belongs in `stores/` or beside the store
    constructor.

32. **`searchSamples` does not normalise input.** `searchSamples.ts:8`
    stores the raw query string. Callers that pass `'  Kick  '` keep
    the whitespace; `getFilteredSamples` then `toLowerCase()`s it but
    does not trim — `state.searchQuery.trim()` is only used as the
    truthiness gate (`getFilteredSamples.ts:46`). A query of `'   '`
    trims to `''` and falsy, so OK; but a query of `' kick '` is
    lowercased to `' kick '` and the filter `s.name.includes(' kick ')`
    will not match `'kick.wav'`. Subtle bug.

33. **`getFilteredSamples`'s search treats the query as a substring,
    not a fuzzy/token match.** A user searching `kick 808` against a
    sample named `808_kick.wav` finds nothing because neither the
    name nor any single tag includes the literal `'kick 808'`. Splitting
    by whitespace and AND-ing matches would dramatically improve hit
    rate; `services/` is the right place for that helper but no such
    helper exists.

34. **`createSampleDatabaseError` is the only error type — and it is
    never thrown except in `addSample`.** `errors/SampleDatabaseError.ts`
    + `addSample.ts:18` are the entire blast radius. No other error
    paths exist (e.g. "rating out of range", "sample not found",
    "invalid format"). Either the error system is over-engineered for
    this module or the rest of the use cases are missing legitimate
    error paths.

35. **Tests do not cover the broken-store baseline.** Every use case
    starts with `if (!state) return;` (or the throw in `addSample`).
    No test exercises that branch — i.e. nothing verifies what
    happens when the store is uninitialised, despite half the
    function bodies being dedicated to that branch.

36. **`sampleDatabaseStore.spec.ts:24` uses non-null assertion `s!`.**
    AGENTS.md: assert escapes are forbidden. `sampleDatabaseStore.update((s)
=> ({ ...s!, searchQuery: 'kick' }))` — the `!` papers over the
    `null` initial-state possibility. Same in `:37`. Tests should
    initialise via `set(...)` (which the `beforeEach` does) and use
    `update((s) => s ? {...s, ...} : s)` or assert on `value`
    explicitly.

---

## Priorities

1. **Lazy/broken tests across the entire `useCases/` folder** (issues
   #5, #6) — fifteen identical "expect X to be defined" specs with
   forbidden namespace imports plus a store spec that constructs an
   illegal `SampleEntry`. Coverage is theatre.
2. **Module-barrel and import discipline broken** (issues #1, #12) —
   no root `index.ts`; every use case self-imports via the absolute
   `#/modules/SoundLibrary/...` alias.
3. **Module is feature-incomplete and largely unreachable** (issues
   #2, #4, #16, #30) — no repository, no persistence, fourteen of
   sixteen use cases never exposed, no handlers in this module, no
   presentation.
4. **`findSimilarSamples` is theatre** (issues #3, #8) — Jaccard over
   16 hand-coded tag names and a path-hash field labelled "audio
   fingerprint".
5. **Auto-tag rules are over-eager** (issues #25, #26) — false
   positives are systematic; the detected `category` is dropped on
   the floor.
6. **Validation gaps** (issues #18, #19, #20, #28) — `addUserTag`
   accepts empty/duplicate names; `rateSample` accepts `NaN`;
   `addSample` populates 8 fields with bogus defaults.

---

## Open issues

### 1. No root `index.ts` — module has no public-surface contract

**Problem:** `src/modules/SoundLibrary/` lacks an `index.ts`. The only
external consumer (`Arrangement/handlers/batchFeature/handleSearchSamples.ts`)
deep-imports `#/modules/SoundLibrary/useCases`. AGENTS.md "Cross-module
imports MUST only target the destination module's root `index.ts`" —
since no root `index.ts` exists, every external reference is
technically invalid by the dependency rules.

**Representative files:**

- `src/modules/SoundLibrary/` (no `index.ts`)
- `src/modules/SoundLibrary/useCases/index.ts` (only public surface)
- `src/modules/Arrangement/handlers/batchFeature/handleSearchSamples.ts:1`

**Needed:** Create `src/modules/SoundLibrary/index.ts` that re-exports
exactly the cross-module surface (today: `searchSamples`; tomorrow:
the `getSampleDatabaseHandlers` aggregator if SoundLibrary owns its
own handlers). Update `handleSearchSamples` to import from
`#/modules/SoundLibrary` (root). Verify with `pnpm deps:validate`.

### 2. No repository / no persistence — module is in-memory-only

**Problem:** No `repositories/` directory; no IndexedDB / Tauri
filesystem code; the store starts empty on every reload. The module's
name implies a sample _library_ — a persistent store of audio assets —
but the implementation is a transient in-memory list. `addSample`'s
positional defaults (`sampleRate = 44100`, `bitDepth = 16`, `channels
= 2`, `fileSize = 0`) reveal that the module does not decode audio
files; it expects callers to supply metadata, and there are no
callers.

**Representative files:**

- `src/modules/SoundLibrary/stores/sampleDatabaseStore.ts:14`
- `src/modules/SoundLibrary/useCases/sampleDatabase/addSample.ts:6-15`
- (No `src/modules/SoundLibrary/repositories/`)

**Needed:** Decide whether the sample library ships persistent. If
yes: build `repositories/sampleLibraryRepository.ts` (IndexedDB for
web, Tauri filesystem for desktop) with `loadAll`, `upsert`,
`remove`, `setRating`, etc., and have `addSample`/`removeSample`/
mutators call through it before updating the store. If no: rename the
module to make its scope honest (`SampleSearchUI`?) and trim the
unused fields from `SampleEntry`.

### 3. `fingerprint` is a path hash labelled as an audio fingerprint

**Problem:** `SampleEntry.fingerprint` JSDoc says "Audio fingerprint
hash for similarity detection". `generatePathHash` (the function
that populates it) hashes `name:path` only — explicitly _not_
perceptual, as the JSDoc admits. No use case reads the field anyway:
`findSimilarSamples` uses tag-name Jaccard, not the fingerprint.

**Representative files:**

- `src/modules/SoundLibrary/models/SampleEntry.ts:46`
- `src/modules/SoundLibrary/services/sampleTaggingHelpers.ts:53-69`
- `src/modules/SoundLibrary/useCases/sampleDatabase/findSimilarSamples.ts:23`

**Needed:** Either build a real perceptual fingerprint
(spectral-peak constellation, Chromaprint, or a downsampled
MFCC-vector hash — read decoded audio in a repository) and feed it
into `findSimilarSamples`'s scoring, or rename
`SampleEntry.fingerprint` to `pathHash`, drop the JSDoc claim, and
change `findSimilarSamples` to weight `bpm`/`key`/`category`/`tags`
explicitly (and document the absence of audio-content similarity).

### 4. Fourteen of sixteen use cases are not exposed and have no callers

**Problem:** `useCases/index.ts:1` re-exports only `searchSamples`.
`addSample`, `removeSample`, `rateSample`, `toggleFavorite`,
`toggleFavoritesOnly`, `addUserTag`, `getFilteredSamples`,
`findSimilarSamples`, `getAllTags`, `getSampleCount`,
`setCategoryFilter`, `setSortBy`, `setTagFilter`, `recordUsage` are
all implemented, tested (fake-tested — see #5), and unreferenced
outside the module. There is no presentation layer, no handler
binding, no AppAction wiring. The module is dormant.

**Representative files:**

- `src/modules/SoundLibrary/useCases/index.ts:1`
- `src/modules/SoundLibrary/useCases/sampleDatabase/*.ts` (15 files)

**Needed:** Either (a) build the missing UI/handler surface so the
use cases become reachable (presentations/views/SampleBrowser, plus
`handlers/`), or (b) delete the unreachable functions until a real
spec drives them. Today's middle ground — implemented but
unreachable, with placeholder tests — is the worst of both worlds.

### 5. All 15 use case spec files are placeholder "should export X" tests with namespace imports

**Problem:** Every spec under `useCases/sampleDatabase/__tests__/`
follows the pattern:

```
import * as subject from '../X';
expect(subject.X).toBeDefined();
expect(typeof subject.X === 'function' || === 'object').toBe(true);
```

Two simultaneous AGENTS.md violations: namespace imports (`import * as
subject`) are forbidden ("Imports: Never use namespace imports") and
"defined / truthy / generic `toBeTypeOf('object')`" tests violate
"TypeScript — soundness: Tests: Do not stop at 'defined' / 'truthy'".

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/__tests__/getFilteredSamples.spec.ts:1-11`
- `src/modules/SoundLibrary/useCases/sampleDatabase/__tests__/findSimilarSamples.spec.ts:1-11`
- `src/modules/SoundLibrary/useCases/sampleDatabase/__tests__/addSample.spec.ts:1-11`
- (and 12 more identical files)

**Needed:** Replace each placeholder with behaviour assertions:
seed the store via `sampleDatabaseStore.set(...)`, call the use
case, assert specific output (filter result equality, sort order,
similarity scores, tag-set contents). Use named imports, not
namespace imports. Specifically `getFilteredSamples` and
`findSimilarSamples` need ≥ 5 cases each (search + filter + sort
combinations; tag-overlap edge cases — empty/full overlap, target
not in store, limit > N).

### 6. `sampleDatabaseStore.spec.ts` constructs an illegal `SampleEntry`

**Problem:** The test (`stores/__tests__/sampleDatabaseStore.spec.ts:29-37`)
literal has `category: 'kicks'` (no such field on `SampleEntry`) and
omits `format`, `durationSec`, `sampleRate`, `bitDepth`, `channels`,
`fileSize`, `bpm`, `key`, `rating`, `color`, `fingerprint`,
`addedAt`, `lastUsedAt`, `useCount`. Compiles via the loose typing
of `update`'s callback. Also uses `s!` non-null assertions
(`:24,37`) — AGENTS.md "TypeScript — soundness" forbids assertion
escapes.

**Representative files:**

- `src/modules/SoundLibrary/stores/__tests__/sampleDatabaseStore.spec.ts:5-42`

**Needed:** Build a typed fixture factory
(`createTestSample(overrides: Partial<SampleEntry>): SampleEntry`)
that fills in all 20 required fields. Replace `s!` with
`if (!s) throw new Error('store uninitialised')` early-return
patterns or assertions on `value`.

### 7. All use cases self-import via the absolute alias

**Problem:** Sixteen files use `import ... from '#/modules/SoundLibrary/...'`
inside the SoundLibrary module. AGENTS.md "Files under
`src/modules/<Name>/` MUST NOT import from `#/modules/<Name>` …
Use **relative** paths." Every single use case file violates this.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/addSample.ts:1-4`
- `src/modules/SoundLibrary/useCases/sampleDatabase/getFilteredSamples.ts:1-3`
- `src/modules/SoundLibrary/useCases/sampleDatabase/findSimilarSamples.ts:1-2`
- (and 13 more)

**Needed:** Rewrite each `#/modules/SoundLibrary/...` import as a
relative path: `../../stores/sampleDatabaseStore`,
`../../models/SampleEntry`, `../../services/sampleTaggingHelpers`,
`../../errors/SampleDatabaseError`. One file at a time, manually,
per the user feedback rule "no automated bulk edits".

### 8. `addSample` takes 8 positional args with bogus defaults

**Problem:** `addSample(path, name, format, durationSec, sampleRate
= 44100, bitDepth = 16, channels = 2, fileSize = 0)`. AGENTS.md
"Functions with more than one parameter take a single object param.
… the input type is named `FunctionNameInput`". The defaults
silently produce `SampleEntry { fileSize: 0, sampleRate: 44100, ...}`
even when the caller has no idea what those values should be.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/addSample.ts:6-15`
- `src/modules/SoundLibrary/useCases/sampleDatabase/setSortBy.ts:4`
- `src/modules/SoundLibrary/useCases/sampleDatabase/addUserTag.ts:3`
- `src/modules/SoundLibrary/useCases/sampleDatabase/rateSample.ts:3`
- `src/modules/SoundLibrary/useCases/sampleDatabase/findSimilarSamples.ts:12`

**Needed:** Refactor each multi-arg use case to take a single object
parameter typed `<FunctionName>Input`. Drop the defaults on
`addSample` — the caller (a real repository decoding audio) should
provide all metadata; never default `fileSize` to `0`.

### 9. `findSimilarSamples` does pure tag-Jaccard with low-cardinality tags

**Problem:** Similarity is computed as Jaccard over tag _names_
only. The auto-tag dictionary has ~16-20 distinct tag names total.
Two samples in the same category but with different keys, BPMs, and
formats score 1.0; conversely two genuinely-similar samples with
slightly different tag sets can score lower than two unrelated
samples that happen to share an auto-tag. The `fingerprint` field
goes unused (#3).

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/findSimilarSamples.ts:23-65`

**Needed:** Combine multiple signals: category match (binary),
key compatibility (relative-key/parallel-key bonus), BPM proximity
(Gaussian on `|bpm_a - bpm_b|`), tag Jaccard (current). Eventually
add audio fingerprint distance once #3 has a real fingerprint.
Document the weighting scheme in JSDoc with a unit test for each
score component.

### 10. Auto-tag rules are over-eager and case-blind

**Problem:** `/loop|bpm/i` matches any filename containing "bpm";
`/perc/i` matches "percussion", "perception", "percent";
`/string/i` matches "g-string"; `/pad/i` matches "lily-pad",
"keypad". Confidence is hard-coded `0.8` regardless of how well the
match aligns. False positives cascade through `getFilteredSamples`'s
category filter (`getFilteredSamples.ts:62`) and pollute
`getAllTags()` results.

**Representative files:**

- `src/modules/SoundLibrary/services/sampleTaggingHelpers.ts:8-27`

**Needed:** Anchor patterns with word-boundaries (`\b(kick|bd|bass.?drum)\b`),
require token-level matches, and back the `confidence` value with
match strength (longer/more-specific match → higher confidence).
Add a service-level test that `autoTagSample('keypad_warm.wav', '/sounds/')`
returns `category: 'piano'` (`/piano|keys|organ|rhodes/i`) without
also tagging `pad`. Track false positives.

### 11. `autoTagSample.category` is computed and discarded

**Problem:** `addSample.ts:21` destructures only `tags` from
`autoTagSample(...)`. The detected `category` is computed by
`autoTagSample` but never written anywhere — `SampleEntry` has no
`category` field. The broken store test (#6) reveals the confusion:
the test author thought `category` _was_ a field. The category
filter (`getFilteredSamples.ts:62`) re-derives membership by joining
`AUTO_TAG_RULES` against the entry's tags, doing the same work
again.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/addSample.ts:21`
- `src/modules/SoundLibrary/services/sampleTaggingHelpers.ts:32-51`
- `src/modules/SoundLibrary/models/SampleEntry.ts:15` (no `category` field)
- `src/modules/SoundLibrary/useCases/sampleDatabase/getFilteredSamples.ts:62`

**Needed:** Add `category: SampleCategory` to `SampleEntry`,
populate it from `autoTagSample`'s return, and rewrite the category
filter to compare directly (`s.category === state.categoryFilter`)
instead of recomputing tag→category for every filter pass.

### 12. `addUserTag` accepts duplicates and empty/whitespace tag names

**Problem:** `addUserTag.ts:13-15` appends unconditionally. Empty
strings and duplicates accumulate.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/addUserTag.ts:3-19`

**Needed:** Trim and validate `tagName.trim().length > 0`.
Deduplicate against the entry's existing `tags` (case-insensitive on
`.name`). Reject reserved auto-tag names (or convert source to
`'user'` and bump confidence).

### 13. `rateSample` accepts NaN

**Problem:** `rateSample.ts:10` clamps via `Math.max(0, Math.min(5,
rating))`. With `rating = NaN`, both bounds return `NaN`. The
sample's `rating` becomes `NaN` and `getFilteredSamples`'s rating
sort breaks (`(NaN - x) * dir` is `NaN`; sort becomes
nondeterministic).

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/rateSample.ts:10`

**Needed:** Validate `Number.isFinite(rating)` and reject (or coerce
to 0) before clamping. Add a test that `rateSample('id', NaN)` is
rejected and a test that `getFilteredSamples` with `sortBy:
'rating'` produces a stable order.

### 14. `getFilteredSamples` memo invariant is undocumented and untested

**Problem:** The memo at `getFilteredSamples.ts:18` keys on
`(state-reference, fingerprint)`. Correct today because every setter
returns a new state reference, but coupling the memo's correctness
to that invariant is fragile. No test asserts that the memo
invalidates when samples change.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/getFilteredSamples.ts:18-40`

**Needed:** Either (a) add `state.samples.length` (and a
`samplesVersion` counter on the store) to the fingerprint and drop
the identity-equality fast path, or (b) keep the identity check and
add a test that mutates `samples` via a setter and confirms the
memo invalidates. Document the invariant in JSDoc.

### 15. Empty `events/index.ts` and `stores/index.ts` placeholders

**Problem:** `events/index.ts` is `// no public events`,
`stores/index.ts` is `// no public stores`. Files that exist solely
to say "nothing here" add noise and imply future content that may
never come.

**Representative files:**

- `src/modules/SoundLibrary/events/index.ts:1`
- `src/modules/SoundLibrary/stores/index.ts:1`

**Needed:** Delete the empty barrels and the empty `events/` folder
(no other files exist there). Once the root `index.ts` is created
(#1), it can re-export only what is actually public — no need for
sub-barrels with placeholder comments.

### 16. Handler for SoundLibrary action lives in the wrong module

**Problem:** `handleSearchSamples` (the `searchSamples` AppAction
binding) lives at
`src/modules/Arrangement/handlers/batchFeature/handleSearchSamples.ts`
— inside `Arrangement`, not `SoundLibrary`. The action concerns the
sample library, not the arrangement; the handler bridges
`searchSamples` AppAction → `SoundLibrary.searchSamples` use case;
that bridge logically belongs in `SoundLibrary/handlers/`.

**Representative files:**

- `src/modules/Arrangement/handlers/batchFeature/handleSearchSamples.ts:1-10`

**Needed:** Move the handler to
`src/modules/SoundLibrary/handlers/handleSearchSamples.ts`. Add
`getSoundLibraryHandlers` aggregator in
`src/modules/SoundLibrary/useCases/getSoundLibraryHandlers.ts`.
Re-export from the new root `index.ts`. Update
`Command/useCases/getAllHandlers` (or wherever the merge happens) to
include it.

### 17. `addSample` throws while sibling mutators silently no-op on missing state

**Problem:** Inconsistent error contract. `addSample.ts:18` throws
`createSampleDatabaseError('Sample database not initialized')`; every
other mutator does `if (!state) return;`.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/addSample.ts:18`
- (silent no-op pattern: 14 other use cases)

**Needed:** Pick a single contract. Recommendation: throw in all
mutators where state-absence indicates a programming error
(`addSample`, `addUserTag`, `rateSample`, `toggleFavorite`,
`toggleFavoritesOnly`); silent no-op for query functions only
(`getFilteredSamples`, `findSimilarSamples`, `getAllTags`,
`getSampleCount`). Consumer-facing errors should go through
`notifyUser` rather than uncaught throws.

### 18. `getAllTags` and `findSimilarSamples` recompute on every call

**Problem:** `getAllTags.ts:8-15` is O(N×T) per call.
`findSimilarSamples.ts:30-49` is O(N×T) per call. Both are query
functions called from likely-hot UI paths (sample browser tag list,
"Similar samples" sidebar). Neither is memoised. Compare to the
already-memoised `getFilteredSamples`.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/getAllTags.ts:3-15`
- `src/modules/SoundLibrary/useCases/sampleDatabase/findSimilarSamples.ts:12-66`

**Needed:** Memoise on `state.samples` identity (or a samples
version counter). For `findSimilarSamples`, an optional
`(targetSampleId, samples-version) -> result` cache would also help.

### 19. `AUTO_TAG_RULES` is mutable

**Problem:** `sampleTaggingHelpers.ts:8`: `export const AUTO_TAG_RULES:
Array<{...}> = [...]`. The reference is sealed; the array is not.
Callers can `.push(...)` new rules.

**Representative files:**

- `src/modules/SoundLibrary/services/sampleTaggingHelpers.ts:8`

**Needed:** `export const AUTO_TAG_RULES = [...] as const;` (or
declare type as `readonly Array<...>`). Update consumers if needed.

### 20. `searchSamples` does not normalise / trim input

**Problem:** Search queries are stored verbatim. A query of `' kick '`
makes `getFilteredSamples`'s substring matcher look for `' kick '`
(with surrounding spaces) — never finds `kick.wav`.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/searchSamples.ts:3-9`
- `src/modules/SoundLibrary/useCases/sampleDatabase/getFilteredSamples.ts:46-52`

**Needed:** `query.trim().toLowerCase()` on the way in, or split on
whitespace and AND-ing matches in the filter.

### 21. `recordUsage` / `toggleFavorite` / `addUserTag` re-build the whole samples array even on miss

**Problem:** Each of these uses `samples.map(s => s.id === id ? ... : s)`.
When `id` is not in the store, the array is rebuilt with the same
references; the store still fires a change notification; subscribers
re-render for no reason.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/recordUsage.ts:8-13`
- `src/modules/SoundLibrary/useCases/sampleDatabase/toggleFavorite.ts:8-11`
- `src/modules/SoundLibrary/useCases/sampleDatabase/addUserTag.ts:8-18`
- `src/modules/SoundLibrary/useCases/sampleDatabase/rateSample.ts:8-12`

**Needed:** Pre-check `state.samples.some(s => s.id === id)`; if
missing, return early. (Or use a single `findIndex` + slice + spread
pattern that avoids the no-change rebuild.)

### 22. `SampleEntry` has many dead fields

**Problem:** `bitDepth`, `fileSize`, `color`, `lastUsedAt`,
`useCount`, `bpm`, `key`, `fingerprint` are all defined but
populated only by `addSample`'s positional defaults
(`addSample.ts`) or by `recordUsage`. There is no edit/import/decode
pipeline that fills `bpm`, `key`, `bitDepth`, etc. The fields
read like aspirational documentation, not real data.

**Representative files:**

- `src/modules/SoundLibrary/models/SampleEntry.ts:15-53`
- `src/modules/SoundLibrary/useCases/sampleDatabase/addSample.ts:23-43`

**Needed:** Either (a) implement the decode/import pipeline (in a
new repository) so these fields get real values, or (b) trim the
model to fields that are actually used. Today's middle ground —
fields exist with bogus default values — is dishonest data.

### 23. `findSimilarSamples` allocates two typed arrays per call

**Problem:** `Int32Array(samples.length)` and `Float64Array(samples.length)`
allocations on every call. For a 200-sample library called from a
hover-driven "similar items" sidebar, that's two ~1.6 KB
allocations per UI hover event.

**Representative files:**

- `src/modules/SoundLibrary/useCases/sampleDatabase/findSimilarSamples.ts:30-31`

**Needed:** Pre-allocate module-level scratch buffers (or revert to
`Array<{i,score}>` + `.sort()` — for N < 1000 the typed-array
overhead exceeds the wins). Memoise per `(targetId, samples-version)`.

### 24. Tests do not exercise the "store uninitialised" branch

**Problem:** Half of every mutator's body is the
`if (!state) return;` guard. No test exercises that branch — i.e.
no test verifies what happens before the store is initialised.

**Representative files:**

- All `useCases/sampleDatabase/__tests__/*.spec.ts`

**Needed:** Add at least one test per mutator that calls it without
a `set(...)` first and asserts no throw / no mutation.

### 25. `addUserTag` confidence value `1` for user tags is not validated

**Problem:** `addUserTag.ts:14`: `confidence: 1`. The `SampleTag.confidence`
field accepts any number; user tags arbitrarily get `1.0` while
auto-tags are `0.8`. There is no documentation or test that
distinguishes the two scales (probability? rank?). `findSimilarSamples`
ignores `confidence` entirely; nothing else reads it.

**Representative files:**

- `src/modules/SoundLibrary/services/sampleTaggingHelpers.ts:41`
- `src/modules/SoundLibrary/useCases/sampleDatabase/addUserTag.ts:14`
- `src/modules/SoundLibrary/models/SampleEntry.ts:11`

**Needed:** Either use `confidence` in the similarity weighting (#9)
or remove the field. As-is it is decorative.

---

## Open questions

- [ ] Is the sample library expected to ship in the next release, or
      is this scaffolding for a future spec? (Affects whether issues
      #2/#4 are bugs or "do not promote" markers.)
- [ ] Where should an audio-decoding pipeline live? `repositories/`
      with Web Audio + `OfflineAudioContext` for web,
      `tauri::command`-backed reads for desktop?
- [ ] Should the `confidence` field on `SampleTag` survive (#25), or
      collapse to a binary `'auto' | 'user'` discriminant?
- [ ] Does any presentation layer in development expect to consume
      `sampleDatabaseStore` directly via deep import?
- [ ] Is `searchSamples`'s AppAction binding intentionally owned by
      `Arrangement` (e.g. because it is part of an arrangement-wide
      batch feature), or accidentally placed there?

---

## Risks

- **Latent failure when used.** The day a UI ships that calls
  `addSample` with real audio metadata, the bogus defaults in #8 will
  silently corrupt records (every entry gets `fileSize: 0`,
  `sampleRate: 44100` regardless of source). Combined with #20
  (whitespace) and #13 (NaN ratings), the data layer is hostile to
  regular UX.
- **Architectural drift normalised.** Issues #1, #7, #15, #16, and the
  spec patterns in #5/#6 are AGENTS.md violations that have lived
  through `pnpm deps:validate` (probably because the validator does
  not enforce "module has root index.ts" or "specs do not use
  namespace imports"). Letting them stand teaches future modules to
  copy the pattern.
- **False sense of test coverage.** Thirty-eight test files give a
  ~100% file-coverage ratio at a glance — but fifteen of them assert
  only "function is defined", and the store spec uses an illegal
  fixture. Refactors of the actual logic will not break the suite.
- **`findSimilarSamples` UX.** If/when the feature is wired to a UI,
  users will see "similar samples" that share only an auto-tag
  (`'drum'`) and disregard key/BPM/category mismatches. Trust in the
  feature will erode.
- **Auto-tagger false positives.** `/string|violin|cello|viola/i` will
  tag `g-string.wav` as orchestral strings; `/pad/i` will tag
  `keypad.wav` as a synth pad. UX degrades silently — users will
  see incorrect tags they did not write and may not know they can
  remove.

---

## Suggested approaches

- **Land the test fix and the import discipline first** (#5, #6, #7).
  They are mechanical, unblock real coverage, and make the next round
  of work safer. Fifteen specs need rewriting (one at a time, named
  imports, real assertions); sixteen use case files need their
  imports rewritten to relative paths.
- **Decide on the module's scope** before touching #2 and #4. If the
  library is shipping: build the repository, the handler folder, and
  the presentation. If not: trim the dead surface area until a spec
  drives it.
- **Combine #11 (drop category) + #10 (anchor regex) + #25 (collapse
  confidence) into a single tagging-pass.** They all affect
  `sampleTaggingHelpers.ts` and `getFilteredSamples`'s category branch.
- **Refactor signatures (#8) and validation (#12, #13, #20) as one
  pass.** Each touches a single use case file; doing them together
  keeps the diff coherent.
- **Defer the perceptual-fingerprint work (#3, #9) until after the
  repository exists.** Real audio fingerprints require decoded audio,
  which requires a repository.

---

## Recommendation

Start with **issue #5 (replace placeholder spec files)** and
**issue #7 (fix self-imports)**. These are mechanical, unblock real
coverage for everything else, and demonstrate AGENTS.md compliance to
`pnpm deps:validate` (if/when those rules are enforced). Land them as
two separate commits: one per concern, sixteen-ish files each, edited
manually.

Then address **issue #1 (root `index.ts`)** and **issue #16 (move the
handler into SoundLibrary)** in a single commit — the new barrel and
the handler relocation are tied.

After those three commits, the next session can choose between a
"feature-completion pass" (#2, #4, #11, #22 — implement the
repository, expose use cases, populate fields) or a
"correctness/validation pass" (#8, #12, #13, #20, #18). They are
independent.

---

## Resolved

_No issues resolved yet._
