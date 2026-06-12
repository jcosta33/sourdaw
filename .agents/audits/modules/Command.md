# Command module audit

## Scope

Covers `src/modules/Command/` in full — `models/`, `stores/`, `useCases/`,
`handlers/`, `services/`, `presentations/`, and tests. Excludes upstream
callers (Arrangement, Workspace, Transport, AiRuntime, etc.) except where
they cross the Command boundary directly.

Adversarial review: bugs, races, contract violations, registry
duplication, undo/redo correctness, keyboard shortcut conflicts,
async dispatch races, type soundness, AGENTS.md compliance, UX/A11y.

Related spec: none on disk.

---

## Verification log (2026-04-28 adversarial pass)

Re-verified every numbered open issue at cited file:line on the source
tree as of `0ef2e91d9`. Findings:

- **Confirmed at source:** #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11,
  #13, #14, #16, #17, #18, #19, #20, #21, #22, #23, #24, #25, #26, #27,
  #28, #29, #30, #31, #32, #33, #34, #36, #37 (after consolidation).
- **#12 (`zoomToSelection` 'F' is dead) — confirmed,** but with a
  different mechanism than originally stated. The audit said the user
  must press "uppercase F without shift, which is impossible." That is
  not why it's dead — `matches()` does case-insensitive single-char
  comparison (`handleKeydown.ts:151-155`), so binding `'F'` would match
  `event.key === 'f'` if the modifier check passed. The actual reason
  it's dead is that `view.zoomToFit` is bound to `['f', 'mod+shift+f']`
  AND is listed earlier (line 317 vs 324) than `view.zoomToSelection`
  with `['F']`. Plain `f` keypress matches `zoomToFit` first; Shift+F
  matches nothing because every binding requires `shift === false`.
  See updated issue #12.
- **#37 (Shift+F dispatches both) — wrong.** Pressing Shift+F matches
  NOTHING at all: `'f'` requires `shift=false`, `'mod+shift+f'`
  requires `mod=true`, and `'F'` requires `shift=false`. The audit's
  claim that "the first definition wins (`zoomToFit`)" was wrong —
  `zoomToFit` only matches plain `f`, not `Shift+F`. The user-visible
  effect is identical (zoomToSelection is dead), so the issue stands,
  but the analysis was sloppy. Folded into #12.
- **#15 (`Escape`/`Enter` overload) — confirmed but bigger.** The
  audit notes inconsistent `preventDefault` returns. Actual call sites
  (`handleKeydown.ts:227-249`) show `Escape`-when-clear-selection
  returns `false` and `Escape`-when-stop-transport also returns
  `false`. Combined with `Enter` going through the same callback,
  pressing Enter to confirm an input may also stop transport unless the
  outer `isInput` guard catches it.
- **#16 (`clearClipSelection` unreachable) — confirmed.** The dead
  alias is on line 280-291, after `transport.stopPlayback` at lines
  83-91. The outer `for ... of definitions` returns on first match.
- **`stores/executeAppAction.ts` is a 3-line re-export proxy** —
  `import { executeAppAction as runExecuteAppAction } from
  '../useCases/executeAppAction'; export const executeAppAction =
  runExecuteAppAction;`. New issue #38 below: this is a "store" file
  that re-exports a use case, which contradicts AGENTS.md's
  store-vs-useCase separation entirely.
- **No issues are resolved.** Nothing from the open list has
  shipped a fix in the codebase. `## Resolved` stays empty.

The new issues hunted in this pass are listed under #38–#54.

---

## Goal

A single-source-of-truth command dispatch layer:

- One `AppAction` discriminated union, one `ActionHandler` shape, one
  `UndoEntry` model. No parallel "models/" vs "useCases/" copies.
- One handler-registry, one undo store, one undo-tree mirror — all
  routed through one `executeAppAction` dispatcher with deterministic
  ordering: `traceAppAction → describe → setSemanticContext →
  execute → recordAction → pushActionHistoryEntry → commitUndoEntry`.
- Every `undoable: true` handler emits a real inverse (action or
  callback). No "undoable but no-op on undo" entries.
- Keyboard shortcut bindings are conflict-free across layers
  (`shortcutStore` + `commandRegistry` + `handleKeydown` + `useCase`
  shortcuts) and consistent with the AppAction contract.
- Macro recording captures every dispatched action that the user
  intends to replay; meta-actions are filtered, undo-history is
  group-aware, and macros survive undo/redo of unrelated actions.
- Undo tree branch switching actually traverses the tree (replays
  inverse + forward actions) — not just bookkeeping.
- AGENTS.md hard rules: no `any`, no `as unknown as`, no `useMemo`/
  `useCallback`/`React.memo`, no `forwardRef`, no own-barrel imports,
  one function per `useCases/` file, single-object params for
  multi-arg functions.

---

## Relevant code paths

- `src/modules/Command/index.ts` (root barrel) — implicit (re-exports
  through `useCases/`, `stores/`, `presentations/views/`).
- `src/modules/Command/models/AppAction.ts` (parallel, larger union)
- `src/modules/Command/models/ActionHandler.ts` (parallel)
- `src/modules/Command/models/UndoEntry.ts` (parallel)
- `src/modules/Command/models/UndoTree.ts`
- `src/modules/Command/models/CommandRegistry.ts`
- `src/modules/Command/models/CommandEntry.ts`
- `src/modules/Command/models/Macro.ts`
- `src/modules/Command/models/commands/*.ts` (11 category files)
- `src/modules/Command/services/commandSearch.ts`
- `src/modules/Command/stores/{executeAppAction,handlerRegistry,undoStore,undoTree,macroStore,shortcutStore}.ts`
- `src/modules/Command/stores/{pushUndoEntry,clearUndoHistory,commitActionUndoEntry,generateGroupId}.ts`
  (duplicated in `useCases/`)
- `src/modules/Command/useCases/commandQueries.ts` (canonical contract,
  duplicates `models/AppAction.ts` + `models/ActionHandler.ts` +
  `models/UndoEntry.ts`)
- `src/modules/Command/useCases/{executeAppAction,commitUndoEntry,undoRedo,clearUndoHistory,pushUndoEntry,traceAppAction,actionLabels}.ts`
- `src/modules/Command/useCases/{getMacroHandlers,getUndoTreeHandlers,selectAllClips,deselectAllClips}.ts`
- `src/modules/Command/useCases/macro/**.ts`
- `src/modules/Command/useCases/undoTree/**.ts`
- `src/modules/Command/useCases/keyboardShortcutActions/**.ts`
- `src/modules/Command/useCases/selectionHelpers/**.ts`
- `src/modules/Command/useCases/pitch/commitPitchEdit.ts`
- `src/modules/Command/handlers/macro/handle*.ts`
- `src/modules/Command/handlers/undoTree/handle*.ts`
- `src/modules/Command/presentations/views/{CommandPalette.tsx,UndoHistoryPanel.tsx,keyboardShortcutsContract.ts}`
- `src/modules/Command/presentations/hooks/useGlobalKeyboardShortcuts.ts`

---

## Current behavior

**Two parallel `AppAction` unions.** `models/AppAction.ts` and
`useCases/commandQueries.ts` both define the union, with **drift**:
`models/AppAction.ts:120` types `setEditingTool.payload.tool` as the
literal union `'select' | 'cut' | 'draw' | 'automation' | 'stretch' |
'marquee'`; `useCases/commandQueries.ts:117` types it as `string`. Same
for the `quality` field on `addChordEvent` (literal union vs `string`)
and `setWarpAlgorithm.algorithm` (literal vs `string`). The
canonical-import path is `commandQueries`; `models/AppAction.ts` exists
but is only consumed via `models/UndoEntry.ts`, `stores/macroStore` /
`stores/commitActionUndoEntry`. So the same action union is imported in
two shapes from two paths inside one module.

**Two parallel `ActionHandler` shapes.** `models/ActionHandler.ts:8`
defines `ActionHandler<Action>`; `useCases/commandQueries.ts:396`
defines an identical shape. `getMacroHandlers` /
`getUndoTreeHandlers` import the `commandQueries` one;
`createHandler<…>` (in `#/utils/createHandler`) presumably the
other — they happen to be structurally compatible but nothing
enforces that.

**Two parallel `UndoEntry`/`createUndoEntry`/`generateGroupId`
modules.** `models/UndoEntry.ts:1-67` and
`useCases/commandQueries.ts:402-467`. `commitActionUndoEntry`
(`stores/commitActionUndoEntry.ts:2`) imports from `models/UndoEntry`,
while `executeAppAction` (`useCases/executeAppAction.ts:7`) imports
from `commandQueries`. The two `createUndoEntry` differ subtly:
`models/UndoEntry.createUndoEntry` uses
`crypto.randomUUID()` (full UUID) for ids; `commandQueries.createUndoEntry`
uses `crypto.randomUUID().slice(0, 8)`. Same for
`createCallbackUndoEntry` and `generateGroupId`.

**`pushUndoEntry` and `clearUndoHistory` exist twice each.**
`stores/pushUndoEntry.ts` (lines 12-26) and
`useCases/pushUndoEntry.ts` (lines 5-17) both implement the same
function with the same arguments. The store version writes directly
to `pushUndo` + `recordToTree`; the use-case version goes through
`commitUndoEntry` (which itself does `pushUndo + recordToTree`). They
end up doing the exact same thing through different call graphs.
Same for `stores/clearUndoHistory.ts` and `useCases/clearUndoHistory.ts`
(both 3-line wrappers around `undoStore.set({ past: [], future: [] })`).
The `stores/index.ts:9-10` barrel exports both `pushUndoEntry` and
`clearUndoHistory`; `useCases/index.ts` does NOT re-export them
(the use-case versions are reachable only by relative import).

**Two duplicate `useGlobalKeyboardShortcuts` hooks.**
`presentations/hooks/useGlobalKeyboardShortcuts.ts` (39 lines) and
`presentations/views/keyboardShortcutsContract.ts` (42 lines) are the
same hook, byte-for-byte identical except for a leading comment block.
The view-layer barrel (`presentations/views/index.ts:6`) exports
the `keyboardShortcutsContract` version; the `hooks/` version is
reachable but unreferenced by the public surface.

**Action dispatch.** `executeAppAction` (`useCases/executeAppAction.ts:23`):
1. `traceAppAction(type, source)` (dev ring buffer).
2. Lookup handler via `getHandlerMap()` — if missing, `logger.error`
   and return.
3. Capture undo info pre-execution by calling `handler.describe(action)`
   if `handler.undoable`.
4. `setSemanticContext({...})` for CRDT message.
5. `await handler.execute(action)` inside try/finally.
6. `recordAction(action)` (macro recording).
7. If `!options?.skipUndo`:
   - `pushActionHistoryEntry(...)` to AiRuntime / CrdtDocument history.
   - `commitUndoEntry(entry)` if `undoResult` was captured.

**Handler registry.** `stores/handlerRegistry.ts` is a flat
`Record<string, ActionHandler<any>>`. `registerHandlerMap` checks for
duplicates and **throws in DEV** / warns in production. `clearHandlerRegistry`
deletes all keys. Bootstrap (presumably `app/registerDependencies`)
calls `registerHandlerMap` once per owning module.

**Undo / redo.** `useCases/undoRedo.ts`:
- `undo()`: pop last entry from `past`. If `groupId` present, walk
  back collecting all consecutive group siblings, then await each
  inverse action serially in reverse. Push entries to `future`.
- `redo()`: pop first from `future`, await its forward action. **No
  group handling on redo.** Compare to undo where group entries are
  treated as a single atomic step: redo of a 5-action group steps
  through one entry per `redo()` call.
- `undoToIndex(targetIndex)`: just calls `undo()` / `redo()`
  repeatedly. With group entries this means a single `undoToIndex`
  call that crosses a group boundary undoes the whole group on the
  first iteration, then the loop runs `stepsBack - 1` more times,
  each undoing additional non-group entries.

**Undo store persistence.** `stores/undoStore.ts:34-68` persists to
`sessionStorage` via a microtask-coalesced subscriber. Only
`isActionEntry` entries are serialized — `CallbackUndoEntry`s are
dropped. After a page refresh the past/future arrays carry only the
serializable subset. The `recordToTree` mirror (which stores the same
entries in `undoTreeStore`) is **not persisted**, so the undo tree is
empty after refresh while `undoStore.past` is partially populated.

**Undo tree.** `useCases/undoTree/recordToTree.ts:9` writes only when
`enabled`. `pushToTree` (`models/UndoTree.ts:50-79`) creates a new
node and links parent → child. `switchBranch`
(`useCases/undoTree/branchOperations/switchBranch.ts:3-22`) only
mutates `node.activeBranch`; **it does not move `currentNodeId`, does
not invoke `executeAppAction` for the new branch's actions, and does
not invert the old branch.** Switching a branch in the UI changes a
data field but the actual document state never moves.

**Macro recording.** `recordAction(action)` is invoked by
`executeAppAction` **after** `handler.execute` resolves but
**before** the undo entry is committed. Failed handlers (those that
throw inside `execute`) still bypass `recordAction` because
`recordAction` runs after the awaited execute — i.e. exceptions
abort recording. Conversely, no-op handlers that resolve without
side effects still record into the macro. Excluded action types
hard-coded at `recordAction.ts:5`:
`startMacroRecording`, `stopMacroRecording`, `playMacro`,
`deleteMacro`. Notably `undo` and `redo` are not excluded — but
they aren't AppAction types either; the user invokes them via
`undoRedo.undo()`. However, `playMacro` is included as an excluded
type — meaning a macro that calls another macro can't be nested,
but also that the second-level macro's actions wouldn't be recorded
regardless because they all run inside an `await` chain with
`groupId` set, so they get a different macro-id key — actually they
**would** be recorded into the outer macro because `recordAction`
just appends `action` to `currentRecording` — only `playMacro`
itself is filtered, the actions it dispatches are not.

**Keyboard shortcut routing.** `handleKeydown.ts:519-528,588-606`
runs **two** loops over `shortcutStore.value.definitions` for the
same key event: one in `handleSimpleKeys` and one in the outer
`handleKeydown` body. The outer loop matches first and returns; the
inner loop is unreachable for any definition that matches the outer
loop. Definitions only reachable via `handleSimpleKeys` are those
that don't match in the outer loop because `isInput` filtered them
— meaning the inner loop runs only when `isInput` is true and the
shortcut isn't `workspace.toggleCommandPalette`, in which case
`handleSimpleKeys` is called from `handleKeydown` after the
`if (isInput) return false` guard at line 611. So the inner loop is
**always unreachable** in the current call graph. Dead code path.

**Command palette.** `CommandPalette.tsx:33-40` calls
`searchCommands(query)` on every render with no memoisation
(per AGENTS.md, the React Compiler handles memoization). Each entry's
`action` is either an `AppAction` or a `() => void` callback. The
palette dispatches via `executeAppAction` for the first and direct
invocation for the second. The aggregated `commandRegistry`
(`models/CommandRegistry.ts:35`) imports 11 sub-files, each
exporting a `CommandEntry[]` const.

**Command registry duplicates the shortcut store partially.**
`models/commands/transportCommands.ts:24` (`stop` → `stopPlayback`,
shortcut `Esc`) and `shortcutStore.ts:84-91` (`Escape` / `Enter` →
contextual stop) both bind Escape; `editCommands.ts:14-29` (Undo /
Redo with `⌘Z` / `⌘⇧Z`) and `shortcutStore.ts:128-141` both bind
Cmd+Z; etc. The two surfaces don't share a source of truth — adding
or removing a shortcut requires editing both.

**Macro action contract gaps.** `renameMacro` is a real use case
(`useCases/macro/management/renameMacro.ts`) and it's exposed
through `useCases/index.ts:16`, but there is **no `renameMacro`
AppAction** — only `deleteMacro`. The contract surface advertises
a use case that has no command-bus path.

**Macros are persisted to localStorage** (`stores/macroStore.ts:30-39`):
the subscriber writes the full macro list to localStorage on every
mutation. Errors are silently swallowed. No coalescing.

**Action labels.** `useCases/actionLabels.ts:8-47` lists 47 action
types out of ~250 in the union. Calls to `describeAction(unknownAction)`
fall through to `action.type`. The function uses
`as Record<string, unknown>` to reach into payloads.

---

## Findings

1. **Three model layers exist for the same concepts.** `models/AppAction.ts`
   + `models/ActionHandler.ts` + `models/UndoEntry.ts` define the
   contract; `useCases/commandQueries.ts` re-defines the same three
   types verbatim with subtle drift (literal-union vs `string` payload
   fields; `crypto.randomUUID()` full-id vs sliced-id). The drift
   means importing from one path vs the other gives different
   guarantees. AGENTS.md "model isolation" forbids cross-module model
   sharing, but it does not authorise *intra-module* duplication.

2. **`stores/` and `useCases/` both implement the same operations.**
   `pushUndoEntry`, `clearUndoHistory`, `generateGroupId`,
   `commitActionUndoEntry`. Two of these (`pushUndoEntry`,
   `clearUndoHistory`) have full duplicate bodies; the others are
   one-line forwarders. AGENTS.md "stores hold state, useCases run
   business operations" — having both implement the same operation
   means *neither* is the canonical one.

3. **Two duplicate `useGlobalKeyboardShortcuts` hooks.** Same code
   in `presentations/hooks/useGlobalKeyboardShortcuts.ts` and
   `presentations/views/keyboardShortcutsContract.ts`. Only the
   second is exported from the views barrel; the first is dead but
   imports just fine and would be live if anyone imported it. A
   future "clean up dead files" pass that picks the wrong one to
   delete will silently break the integration.

4. **`handleDeleteMacro` is `undoable: true` but emits no inverse.**
   `handlers/macro/handleDeleteMacro.ts:5-11` returns
   `describe: () => ({ label: 'Delete Macro' })` with no
   `inverseAction`. The undo entry is committed with
   `inverseAction: null`, so undo of "Delete Macro" is a no-op —
   but it does consume a press of Cmd+Z, silently advancing the
   user past the action they were trying to recover. This is the
   worst kind of undo bug: the UI says "undo" succeeded.

5. **`switchBranch` in the undo tree never traverses.**
   `useCases/undoTree/branchOperations/switchBranch.ts:3-22` only
   updates `node.activeBranch` and does not change
   `tree.currentNodeId`, does not invoke any inverse actions for
   the old branch's path, and does not replay actions for the new
   branch. The undo tree UI (if any) reflects a different "current
   branch" but the document state is unchanged. Branching undo
   is currently scaffolding that does not do what its name implies.

6. **Undo tree is not persisted.** `stores/undoTree.ts:15-20`
   creates a `createStore` with no `storage` adapter. After a page
   refresh, the user has `undoStore.past` (action entries only,
   callbacks dropped) but a fresh empty tree. The mirror invariant
   between `undoStore` and `undoTreeStore` cannot hold across
   reloads.

7. **`recordToTree` only fires when the tree is `enabled`.**
   `useCases/undoTree/recordToTree.ts:9-13` returns early when
   `state.enabled === false`. Toggling the tree on mid-session
   gives the user a tree that contains only entries committed
   *after* the toggle — every prior undo entry is missing. There
   is no "rebuild from undoStore.past" path. The user has to start
   fresh.

8. **`redo` does not collapse groups; `undo` does.**
   `useCases/undoRedo.ts:22-57`: `undo()` walks back through
   `groupId` siblings and applies them as one atomic operation.
   `redo()` (`:59-74`) operates on `state.future[0]` only and
   rebuilds `future` minus that single entry. After undoing a
   5-action macro, the user must press Cmd+Shift+Z **5 times** to
   re-apply it. Asymmetry inherent to the data shape (future
   doesn't preserve group ordering after the asymmetric undo
   shape).

9. **`undoToIndex` interacts poorly with groups.**
   `useCases/undoRedo.ts:76-98`: targets the array index of `past`,
   then steps via `undo()`. If the target index falls inside a
   group, the group is undone whole, overshooting the target by
   `groupSize - 1` entries. The loop then tries to step back by
   `stepsBack - 1` more, but those are *new* entries because the
   group has been pushed onto `future`. Result: undo history slides
   into an inconsistent state.

10. **Sequential `await` in `undo()` for group rollback.**
    `useCases/undoRedo.ts:39-41`: each inverse action awaits
    `runExecuteAppAction`. Inside `executeAppAction`, the awaited
    handler may dispatch further actions through the same dispatcher
    (e.g. a CRDT change → store subscriber → handler). If two
    `undo()` calls overlap (user holding Cmd+Z, OS auto-repeating
    while the previous undo is still resolving), both reach
    `state.past.length > 0`, both pop the same `lastEntry`, both
    set `undoStore.set({ past: state.past.slice(0, -1), … })` with
    the same `state.past` snapshot. The second call clobbers the
    first; one of the two inverse actions is applied twice and the
    other not at all. There is no in-flight guard.

11. **`executeAppAction` re-entrancy is uncontrolled.**
    Same root cause as #10: `executeAppAction` is `async` and
    `await`s `handler.execute`. A handler that itself dispatches
    `executeAppAction(otherAction, { skipUndo: true })` is supported
    (and used in macros). But a user-driven sequence of two
    parallel calls — one from the keyboard, one from the command
    palette while a slow handler is running — interleaves
    `setSemanticContext` / `clearSemanticContext` calls.
    `setSemanticContext` is global; the inner action's clear clears
    the outer's context before the outer has finished. CRDT changes
    after the inner `clearSemanticContext` are committed without
    a semantic message.

12. **Handler registry is silent in production.** `registerHandlerMap`
    (`stores/handlerRegistry.ts:24-35`): "throw in DEV, warn in
    prod" on duplicate registration. Production gets a `logger.warn`
    and **the second registration wins** (`registry[key] = map[key]`).
    A bootstrap-order regression that registers `handle*Foo` twice
    will silently swap which implementation the user gets. There
    is no test for "every action type has exactly one handler".

13. **Action-payload type drift between `models/AppAction` and
    `useCases/commandQueries`.** `setEditingTool.payload.tool`:
    literal union vs `string`. `addChordEvent.payload.quality`:
    literal union vs `string`. `setWarpAlgorithm.payload.algorithm`:
    literal union vs `string`. Handlers typed against
    `commandQueries` accept any string; handlers typed against
    `models/AppAction` only accept the literals. The bootstrap
    `setEditingTool` handler registers as the latter; the
    `executeAppAction` cast is `ActionHandler<any>`, so a typo
    (`'cuT'`) makes it through dispatch and lands in the handler
    where `setEditingTool: 'cuT'` is silently accepted (or ignored,
    depending on the Workspace implementation).

14. **`handleAudioToMidi`-style "payload contract advertises but
    ignores fields" pattern is also here.** `audioToMidi.payload`
    has `mode?: string` (per `commandQueries.ts:256`) — but the
    Command-side AppAction has no enforcement that the field is
    one of the supported modes. Cross-reference with
    AudioAnalysis.md issue #3 — the same problem here, on the
    Command boundary.

15. **`Escape` / `Enter` shortcut binding is overloaded.**
    `shortcutStore.ts:84-91` `transport.stopPlayback` binds
    `['Escape', 'Enter']`. Inside `handleKeydown.ts:227-249`,
    `Escape` is interpreted contextually — clear ghost, clear
    selection (returns `false` → no preventDefault), stop loop
    station, stop playback. **`Enter` goes through the same
    code path**, but `Enter` is also commonly used to confirm
    inputs / dialogs. The `isInput` guard catches inputs and
    contenteditable, but custom focus traps in the rest of the
    app may still receive Enter as "stop transport". That's a
    surprising shortcut for confirm-via-keyboard-navigation.

16. **`workspace.clearClipSelection` shortcut is unreachable.**
    `shortcutStore.ts:281-291` defines `clearClipSelection` bound
    to `Escape`. But `transport.stopPlayback` (`:84-91`) is bound
    to `Escape` *and listed earlier* in `INITIAL_DEFINITIONS`
    (line 84 vs 282). `handleKeydown.ts:588-606` iterates
    `definitions` in order and returns on the first match; the
    second `Escape` binding is never reached. The comment on
    `clearClipSelection.ts:285-289` acknowledges this is an alias,
    but it's still a definition that contributes nothing — it
    would matter only if `transport.stopPlayback` were renamed to
    not include Escape, in which case the alias would silently
    take over.

17. **Two `Escape` paths return different `preventDefault` signals.**
    `handleKeydown.ts:236-238`: when Escape clears selection, the
    function returns `false` (don't preventDefault). `:247-248`:
    when Escape stops transport, returns `false`. `:233`: when
    Escape dismisses ghost, returns `true`. So Escape handling is
    inconsistent about whether it preserves the browser default
    (e.g. closing a focused dialog). A focus-trapped dialog will
    interpret one Escape as "close this dialog AND clear selection
    AND stop transport".

18. **CommandPalette duplicates shortcut definitions in plain
    text.** `models/commands/transportCommands.ts:14`: `shortcut: 'Space'`,
    `:23` `shortcut: 'Esc'`, etc. — these strings are display-only.
    They are not derived from `shortcutStore` and will silently
    drift if anyone rebinds. `editCommands.ts:15` says
    `shortcut: '⌘Z'`, `:25` `'⌘⇧Z'`, `:75` `'⌘⇧D'` —
    `⌘⇧D` for `deselect-all` is wrong on multiple fronts:
    `shortcutStore.ts:296` binds `mod+shift+d` to
    `arrangement.duplicateTrack`, not deselect, and there is no
    deselect shortcut at all in `shortcutStore`. The palette is
    advertising a binding that does not exist.

19. **CommandPalette and shortcutStore have overlapping sources of
    truth.** Adding an action that is both a palette entry and a
    keyboard shortcut requires editing two unrelated files.
    `transportCommands` `toggle-recording` says `shortcut: 'R'`;
    `shortcutStore` says `'r'`. They happen to both work, but
    nothing keeps them aligned.

20. **`recordAction` runs after `await execute` but before
    `pushActionHistoryEntry` / `commitUndoEntry`.** Ordering is
    `execute → recordAction → undo entry`. If a handler throws,
    none of the post-execute steps run — including
    `clearSemanticContext` runs in `finally`, but `recordAction` is
    skipped. The macro records only successful actions. Reasonable
    behaviour, but undocumented; coupled with the silent
    `logger.error` for missing handlers (`executeAppAction.ts:29`)
    a user recording a macro can have an action silently dropped if
    the handler is missing.

21. **`recordAction` does NOT exclude `undo` / `redo`** — but
    those aren't AppAction types either. They are invoked via
    `undoRedo.ts` directly, bypassing `executeAppAction`. **However,
    `executeAppAction` IS called from inside `undo()` (line 40)
    and `redo()` (line 18) for the inverse / forward action.**
    So if the user is recording a macro and presses Cmd+Z, the
    *inverse action* gets recorded into the macro. Replaying the
    macro will then execute the inverse action as a normal step,
    which is almost certainly not what the user expected. The
    excluded list does not cover this path because the Command-side
    `recordAction` cannot tell that the action came from `undo()`.

22. **Macro persistence has no error feedback.**
    `stores/macroStore.ts:30-39`: `localStorage.setItem` failures
    are swallowed with a comment "Storage full — silently degrade".
    The user records a macro, the page refreshes, and the macro is
    gone. No `notifyUser`, no `logger.warn`, nothing.

23. **Macro persistence is not coalesced.** `undoStore.ts:43-68`
    coalesces sessionStorage writes via `queueMicrotask`;
    `macroStore.ts:30-39` does not. Every action recorded into a
    macro re-serializes the *entire* macros array (including all
    saved macros) to localStorage. Recording a 1000-step macro
    triggers 1000 full localStorage writes.

24. **Macro recording captures `currentRecording`, not undo
    entries.** Implication: a macro is a literal action sequence
    that ignores any `groupId` semantics. Replaying a 5-action
    macro creates 5 undo entries (each grouped under one
    `Macro: <name>` group, see `playMacro.ts:21`). But undoing a
    saved macro that was originally recorded inside an existing
    group recreates a new group, not the original. Predictable but
    not documented.

25. **`renameMacro` use case has no `AppAction`.**
    `useCases/macro/management/renameMacro.ts` is exposed via
    `useCases/index.ts:16` with no command-bus path. Means
    "rename macro" cannot be done from the command palette, AI,
    or voice — only via direct `renameMacro(id, name)` import,
    which is a cross-module function call that bypasses the
    handler / undo / macro layers. Either drop it or add an
    AppAction.

26. **`commitPitchEditCommand` is exported through `useCases/index.ts:25`
    with no audit trail.** No handler, no AppAction; presumably
    invoked imperatively by PianoRoll. This sits awkwardly in the
    Command barrel — Command's contract is "register handlers,
    dispatch actions, replay undo", not "expose ad-hoc helpers
    that other modules wrap an undo entry around". Either move to
    Arrangement or wrap in a real AppAction.

27. **`actionLabels.ts` ACTION_LABELS covers ~47 of ~250 actions.**
    `useCases/actionLabels.ts:8-47`. The fallback `action.type`
    leaks the camelCase enum string into the UI. Examples not
    covered: `setMasterGain`, `setPunchIn`, `setSnapValue`,
    `groupTracks`, `flattenTrack`, `freezeTrack`, every AI
    generation action, every elastic editor action, every adjustment
    layer action — all surface as `setMasterGain`,
    `groupTracks`, etc. in the UI.

28. **`describeAction` payload-introspection uses `as Record<string,
    unknown>`.** `useCases/actionLabels.ts:54`. AGENTS.md
    "TypeScript — soundness" forbids assertion escapes. Each
    "if 'name' in param" branch then casts `param.name as string`
    implicitly via the template literal — works because the runtime
    JS just converts to string, but the type promise is unsound.

29. **Trace ring is dev-only, single global.**
    `useCases/traceAppAction.ts:78-83`: stores ring on `window`. HMR
    will leak rings if `__sourdaw_trace__` is replaced. Two
    parallel `executeAppAction` rebuilds (rare but possible) will
    both push to the same ring under different module-instance
    closures. Minor.

30. **Pass-through useCases in `keyboardShortcutActions/trackShortcuts/`.**
    `addTrack.ts`, `duplicateTrack.ts`, `duplicateClip.ts`,
    `duplicateClipToNextBar.ts`, `clearSolos.ts` are 3-line
    re-exports of the `Arrangement/useCases` function under the
    same name. Same anti-pattern as AudioAnalysis's `audioAi/*` files
    (cross-reference AudioAnalysis.md issue #14). Five files of
    indirection that add no value.

31. **`zoomTracksVertical.ts`, `zoomToFit.ts`, `zoomToSelection.ts`,
    `setEditingTool.ts` in `keyboardShortcutActions/workspaceShortcuts/`
    follow the same pattern.** Pure pass-throughs to Workspace /
    Arrangement.

32. **`handleKeydown` is one 632-line function with nested
    closures.** `useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:188-632`.
    Multiple state machines (AI leader, tool swap), two separate
    shortcut-store iteration loops (one unreachable, see #16),
    contextual Escape handling. AGENTS.md "one function per file"
    — this file is `handleKeydown` but it contains
    `executeShortcutAction`, `executeDuplicateTimeRange`,
    `getSelectedGhostClipId`, `deleteSelectionShortcut`,
    `handleSimpleKeys`, `armAiLeader`, `disarmAiLeader`,
    `isAiLeaderArmed`, `dispatchAiChord`, `matches`. Module-level
    mutable `aiLeaderState` (line 54) is HMR-leaky and
    test-unfriendly.

33. **AI leader chord uses `performance.now()` and module-level
    state.** Two windows / tabs share the same module instance,
    but the leader-arm state is process-global. A second tab that
    arms `g` then switches focus to the first tab and presses `d`
    will dispatch `generateDrumPattern` in the first tab. Edge
    case but real.

34. **Tool-swap uses module-level `toolSwapStore` and 300 ms
    threshold.** `handleKeyup.ts:18-23`. Hard-coded number with
    no unit comment. The `lastDownKey` is not cleared on
    `handleKeydown` for *different* keys, so pressing `1` then
    `2` will leave `1`'s previous-tool around; the next `keyup`
    for `1` (potentially long-released) triggers a stale swap.

35. **`matches()` `Space` mapping handles `' '` but not other
    "named-key" mismatches.** `handleKeydown.ts:147` handles
    `Space → ' '`. Does not handle `Esc` vs `Escape`,
    `Backspace`, `Tab`, `Enter`, `Home`, `End`, `Arrow*`, etc.
    Definitions use `'Escape'` and `'Backspace'` and `'Tab'` and
    `'Home'` and `'Enter'` directly because `event.key` returns
    those names — but `Esc` (in `transportCommands.ts:24`
    palette display) would not match. Brittle.

36. **`matches()` modifier match is exact-equality.** `mod+z` does
    not match `mod+shift+z` (good, that's intended), but
    `mod+=` does not match `mod+shift+=` either (also good), but
    a binding like `'shift+a'` will not match the OS-typed `'A'`
    — `event.key` for `Shift+A` is `'A'` (uppercase), modifier
    `shift = true`. The case-insensitive match (`:153-155`) saves
    this for single-char keys, but `'F'` (uppercase F) at line
    324 is bound `defaultKeys: ['F']` *with no `shift+` modifier*
    — meaning the user has to press *uppercase F without shift*,
    which is impossible on a standard keyboard. The intent is
    probably `'shift+f'`.

37. **`zoomToSelection` is dead (corrected).** `shortcutStore.ts:317,324`.
    Original analysis incorrectly claimed Shift+F matches both
    bindings via case-insensitivity. Re-traced: `matches()` enforces
    `hasShift === desc.shift` exact-equality (line 157), so `'f'` and
    `'F'` (both no-shift) cannot match a Shift+F press
    (`desc.shift = true`). Plain `f` matches `zoomToFit` first
    because that definition is listed earlier (line 317 vs 324) and
    the outer loop returns on first match. `zoomToSelection` never
    fires. See updated open issue #12.

38. **`mod+shift+f` is bound to `view.zoomToFit` AND `f` is also.**
    `shortcutStore.ts:317`: `defaultKeys: ['f', 'mod+shift+f']`.
    This isn't a conflict per se (one definition, two bindings),
    but `'mod+shift+f'` is a non-standard combo for "zoom to fit"
    in any DAW, and `'F'` (which is intended as zoom-to-selection)
    could not collide with `'mod+shift+f'`. The intent is muddled.

39. **`view.zoomTracksVerticalIn` uses `mod+shift+=` AND
    `mod+shift++`** (line 331), but `view.zoomIn` uses
    `mod+=` AND `mod++` AND `=` AND `+`. Pressing `Shift+=` (which
    is `+`) without `mod` would match the `+` binding on
    `view.zoomIn` first. Pressing `Cmd+Shift+=` would match
    `mod+shift+=` on `view.zoomTracksVerticalIn`. Pressing `Cmd+=`
    (no shift) would match `mod+=` on `view.zoomIn`. Hard to keep
    straight; the "bind both `=` and `+` separately because of
    `Shift` interaction" approach is fragile.

40. **`mod+t` is bound to `workspace.toggleTrackList`** —
    but Cmd+T in browsers / Tauri / desktop apps almost universally
    means "new tab" or "new track" or similar. The browser default
    is `preventDefault`-blocked here (the callback returns `true`).
    In Tauri the OS may still consume Cmd+T at the window level.
    Marginal — needs platform testing.

41. **`g` is a leader key but also the alphabet letter `g`.**
    Pressing `g` while no input is focused arms the AI chord; the
    user's other intent for `g` (e.g. moving in a piano roll
    context) is broken. The `isInput` guard helps in form fields
    but not in custom-focused contexts (canvas-based editors).

42. **`a` (cycle automation visibility) returns `false` to NOT
    preventDefault.** `handleKeydown.ts:272-274`. Means the
    browser still sees the keypress and may scroll or trigger
    page-find. Inconsistent with most other shortcuts.

43. **Loop-station pad shortcut can't be customised
    independently.** `shortcutStore.ts:52-73` constructs 64
    definitions (32 play + 32 record) at module load with hard-coded
    `defaultKeys`. The UI has no surface to remap them. The
    `customMappings: Record<string, string[]>` does support per-id
    overrides, but no UI lists these 64 ids.

44. **`shortcutStore.subscribe` writes to localStorage on every
    update.** Implicit via `createLocalStorage` adapter. No
    coalescing visible. Same problem class as #23.

45. **Group-undo replay races.** `undoRedo.ts:39-41`: each
    inverse in the group is awaited, but **the snapshot of
    `state.past` is taken at the start of `undo()`** (line 23).
    If any of the inverse actions push new entries into
    `state.past` (because they themselves are dispatched via
    `executeAppAction`, which commits an undo entry under
    `skipUndo: false` by default), `state.past.slice(0, index + 1)`
    truncates including the new entries. **The new entries are
    silently dropped** because `undoStore.set({ past: newPast, … })`
    is called from the snapshot, not the live store. The inverse
    actions themselves should pass `skipUndo: true` — the
    `executeUndo` helper does **not** pass any options:
    `await runExecuteAppAction(entry.inverseAction)` with no options
    means each inverse becomes a fresh undo entry of its own. Combined
    with the snapshot truncation, undo is fundamentally broken for
    grouped actions.

46. **`pushActionHistoryEntry` happens regardless of group, source,
    or success.** `executeAppAction.ts:60-72`. Every action
    (except `skipUndo`) is logged to action history with full
    payload. AI-generated commands intermingle with user commands
    using only the `source` field. Privacy / size implications
    if action history persists.

47. **`setSemanticContext` / `clearSemanticContext` are imported
    from CrdtDocument.** `executeAppAction.ts:3`. Cross-module
    import is fine (CrdtDocument is upstream of Command in the
    dep graph). But the try/finally only clears the context after
    `await handler.execute(action)`. If the handler dispatches
    further actions inside its execute, those further dispatches
    re-set the context with their own labels, which then
    `clearSemanticContext()` after they resolve, and the outer
    handler's remaining work runs without semantic context. CRDT
    changes after the inner clear are unlabelled.

48. **`executeAppAction` cast through `any`.**
    `executeAppAction.ts:27`: `getHandlerMap()[action.type] as
    ActionHandler<any> | undefined`. AGENTS.md "TypeScript —
    soundness" forbids `any`. The cast exists because `HandlerMap`
    is `Record<string, ActionHandler<any>>` and `action.type` is
    a literal-union string, but no helper narrows the result to
    `ActionHandler<typeof action>`. `commandQueries.ActionHandler`
    is generic — there should be a typed `getHandler(action)` that
    returns `ActionHandler<typeof action> | undefined`.

49. **`HandlerMap = Record<string, ActionHandler<any>>`.**
    `stores/handlerRegistry.ts:20`. Same `any` problem one level
    higher; same eslint-disable. The handler registry's API is
    typed at the lowest-common-denominator and re-narrows at
    every call site.

50. **`undoStore.set({...})` race in concurrent undo / redo.**
    `useCases/undoRedo.ts:43-46`: after the awaited inverses
    apply, `undoStore.set({ past: newPast, future: [...groupEntries,
    ...state.future] })` uses the closed-over `state.past` /
    `state.future`. Any other writer that committed an undo entry
    in the interval between line 23 and line 43 (e.g. a Workspace
    UI write or another undo call) is silently overwritten.

51. **CommandPalette has no keyboard escape handling.**
    `CommandPalette.tsx:56-115`. The Dialog component handles
    Escape to close, but the `handleKeyDown` handler at `:42-53`
    only manages Arrow / Enter. Pressing Escape closes the
    dialog, but does not call `closeCommandPalette()` directly —
    relies on `onOpenChange` from Dialog. If Dialog's escape
    handling is intercepted (focus trap), the palette can be left
    half-open.

52. **CommandPalette `useStore(workspaceStore)?.commandPaletteOpen`
    re-runs on every workspace store change.** No subscription
    selector; the entire workspace store is read. AGENTS.md
    cross-reference: PianoRoll audit (I-27) optimised this exact
    pattern. Command palette has the same problem at
    `CommandPalette.tsx:15`.

53. **`UndoHistoryPanel` reads full `undoStore`.**
    `UndoHistoryPanel.tsx:25`: `useStore(undoStore, defaultState)`
    re-renders on every undo/redo push. Acceptable, but the
    `[...state.past].reverse()` at `:95` and `[...state.future]
    .reverse()` at `:68` allocate new arrays on every render.
    Probably fine given panel cardinality.

54. **`UndoHistoryPanel` uses `undoToIndex`.** Cross-reference #9
    — `undoToIndex` is broken for groups. Clicking a row inside
    a group does not jump *into* the group; it overshoots.

55. **No tests for the dispatch ordering invariants.** The flow
    `traceAppAction → describe → setSemanticContext →
    execute → recordAction → pushActionHistoryEntry →
    commitUndoEntry` has no unit test. Reordering or skipping a
    step would only show up if a downstream test (e.g.
    AiRuntime's action history test) caught it.

56. **No tests for "every action type is handled exactly once".**
    The handler registry duplicate-detection is enforced at
    runtime in DEV, but a test that builds the registry and asserts
    `Object.keys(registry).sort()` matches the AppAction type-union
    keys would catch missing handlers. None exists.

57. **No test for shortcut-key conflicts.** A test that walks
    `shortcutStore.value.definitions`, normalises every binding,
    and asserts no two definitions resolve to the same combo
    (modulo intentional contextual aliases like
    `transport.stopPlayback` + `clearClipSelection` on Escape)
    would catch issues #16, #18, #19, #37, #38. None exists.

58. **No `e2e` or integration test for `handleKeydown` matching.**
    `__tests__/handleKeydown.spec.ts` exists but only exercises a
    handful of paths. The matrix of `(key, mod, shift, alt,
    isInput, loopStationArmed)` × `definitions` is huge; the
    tests sample a few rows.

59. **AGENTS.md violations.** Self-barrel-style imports inside
    Command (e.g. `useCases/getMacroHandlers.ts:6`
    `from './commandQueries'` is fine; but `presentations/views/CommandPalette.tsx:11-12`
    imports `../../models/CommandRegistry` and
    `../../useCases/executeAppAction` — relative, OK).
    `useCases/index.ts:6` `export type { AppAction, ActionHandler }` — AGENTS.md
    "Use-case types stay private" applies (cross-reference
    AudioAnalysis audit issue #17). Even though `AppAction` is
    the contract surface, exporting `ActionHandler` from
    `useCases/` leaks into the cross-module barrel.

60. **AGENTS.md "single object param" violations.**
    `useCases/pushUndoEntry.ts:5` takes `(label, undoFn, redoFn,
    options?)` — four positional params. `stores/pushUndoEntry.ts:12`
    same. `useCases/keyboardShortcutActions/trackShortcuts/addTrack.ts:3`
    `addTrack(opts)` — fine. `commandQueries.ts:427`
    `createUndoEntry(label, action, inverseAction, source)` — four
    positional. `models/UndoEntry.ts:28` same. `createCallbackUndoEntry`
    in both files: `(label, undoFn, redoFn, source)` — four
    positional.

61. **`useCases/pitch/commitPitchEdit.ts` lives under
    `useCases/pitch/` but is not pitch-detection.** It handles
    pitch *editing* (PianoRoll-side). Naming collides with the
    AudioAnalysis pitch detection. Future readers searching for
    "pitch detection" land on the wrong file.

62. **`stores/handlerRegistry.ts` `delete registry[key]` for
    `clearHandlerRegistry`.** Re-creating the registry at HMR
    requires this; but `delete` on a Record is slow (deopts the
    object's hidden class). For a 250-key registry, this runs
    250 deletes on every HMR. Replace with `Object.keys(registry).forEach((k) => { (registry as Record<string, unknown>)[k] = undefined; })` or
    re-instantiate.

63. **Macro recording + undo/redo replay round-trip is broken.**
    Combination of #21 (undo's inverse-actions are recorded) and
    #5 (switchBranch is no-op): a session that records a macro,
    then undoes one step (recording the inverse), then redoes,
    then stops the macro recording, results in a macro containing
    `[a1, a2, inverse-of-a2, a2]` instead of just `[a1, a2]`.
    Replaying it dispatches each in order, leading to a
    surprise-state-mid-replay.

---

## Priorities

1. **Three parallel model layers** (issue #1) — `AppAction`,
   `ActionHandler`, `UndoEntry` defined twice with drift. Pick the
   canonical path (`useCases/commandQueries.ts` is the live one)
   and delete the others.
2. **`handleDeleteMacro` undoable but no inverse** (issue #4) —
   silent undo no-op. Either add the inverse or set `undoable:
   false`.
3. **Undo group race + non-skipUndo inverses** (issue #45) —
   undo of a grouped action commits *new* undo entries for each
   inverse, races with the parent's `undoStore.set` snapshot,
   and silently drops some entries. Fundamental correctness.
4. **`switchBranch` does not traverse the undo tree** (issue #5)
   — branching undo is scaffolding that only updates a label.
5. **`stores/`-vs-`useCases/` operation duplication** (issue #2)
   — `pushUndoEntry`, `clearUndoHistory`, `commitActionUndoEntry`,
   `generateGroupId` exist in both folders. Pick one.
6. **Two duplicate `useGlobalKeyboardShortcuts` hooks** (issue #3)
   — delete the unreferenced one.
7. **`Escape` shortcut overload + unreachable `clearClipSelection`**
   (issues #16, #17) — multi-binding contract is brittle.
8. **`zoomToSelection` shortcut is dead** (issue #37) —
   `'F'` binding with no `shift+` modifier never matches.
9. **`undoToIndex` overshoots groups** (issue #9) — the panel
   uses this; clicking a history row inside a group breaks.
10. **`recordAction` records inverse actions during undo while
    macro is recording** (issue #21) — replaying produces nonsense.
11. **`commitPitchEditCommand` exposed in barrel without a real
    contract** (issue #26) — leaky abstraction.
12. **`renameMacro` use case has no AppAction** (issue #25) —
    contract gap.
13. **AGENTS.md violations** (issues #48, #49, #59, #60) — `any`
    in dispatch, pass-through useCases, type re-exports from
    `useCases/`, positional args.

---

## Open issues

### 1. Three model layers (`AppAction` / `ActionHandler` / `UndoEntry` × 2)

**Problem:** `models/AppAction.ts`, `models/ActionHandler.ts`,
`models/UndoEntry.ts` re-define the same types as
`useCases/commandQueries.ts:32-470`. The two `AppAction` unions drift
on payload literal-vs-string fields. The two `createUndoEntry`s drift
on full-vs-sliced UUIDs. Different parts of the module import from
different sources.

**Representative files:**

- `src/modules/Command/models/AppAction.ts:34-431` (literal payload types)
- `src/modules/Command/useCases/commandQueries.ts:32-470` (string payload types, sliced UUIDs)
- `src/modules/Command/models/ActionHandler.ts:8-12`
- `src/modules/Command/models/UndoEntry.ts:1-72`
- `src/modules/Command/stores/macroStore.ts:4` (imports from `commandQueries`)
- `src/modules/Command/stores/commitActionUndoEntry.ts:1-2` (imports from `models/`)

**Needed:** Pick one canonical path (recommend `useCases/commandQueries.ts`
since it's the cross-module contract surface and is more widely imported).
Delete the other three model files. Run typecheck; fix any drift the
deletion exposes (especially the `setEditingTool.tool` and `addChordEvent.quality`
literal-union enforcement). Add a one-line README at the chosen path
explaining "this is THE contract".

### 2. `pushUndoEntry`, `clearUndoHistory`, `commitActionUndoEntry`, `generateGroupId` exist in both `stores/` and `useCases/`

**Problem:** Two files implement the same operation with the same
arguments. `stores/pushUndoEntry.ts` writes directly via
`pushUndo + recordToTree`; `useCases/pushUndoEntry.ts` goes through
`commitUndoEntry` (which itself does `pushUndo + recordToTree`). Same
behavior, different call graphs.

**Representative files:**

- `src/modules/Command/stores/pushUndoEntry.ts:12-26`
- `src/modules/Command/useCases/pushUndoEntry.ts:5-17`
- `src/modules/Command/stores/clearUndoHistory.ts:1-6`
- `src/modules/Command/useCases/clearUndoHistory.ts:1-5`
- `src/modules/Command/stores/commitActionUndoEntry.ts:16-34`
- `src/modules/Command/useCases/commitUndoEntry.ts:13-16` (similar)
- `src/modules/Command/stores/generateGroupId.ts:1-6`
- `src/modules/Command/useCases/commandQueries.ts:461-466`

**Needed:** AGENTS.md "stores/ hold mutable state, useCases/ contain
business operations". Push these to one side. The
`recordToTree`-on-push side effect is business logic, not state; it
belongs in `useCases/`. Delete `stores/pushUndoEntry`,
`stores/clearUndoHistory`, `stores/commitActionUndoEntry`,
`stores/generateGroupId`. Fix the `stores/index.ts` barrel and any
external importers. Add a unit test that asserts there's exactly
one `pushUndoEntry` reachable from the public barrel.

### 3. Two `useGlobalKeyboardShortcuts` hooks

**Problem:** `presentations/hooks/useGlobalKeyboardShortcuts.ts` and
`presentations/views/keyboardShortcutsContract.ts` are byte-equivalent
hooks. Only the second is exported. The first is dead but live as an
import target.

**Representative files:**

- `src/modules/Command/presentations/hooks/useGlobalKeyboardShortcuts.ts:1-39`
- `src/modules/Command/presentations/views/keyboardShortcutsContract.ts:1-42`

**Needed:** Delete the one in `hooks/`. Remove the empty `hooks/`
directory if no other hook lives there. Verify `useGlobalKeyboardShortcuts`
is only imported from one path across the codebase.

### 4. `handleDeleteMacro` is `undoable: true` with no inverse

**Problem:** `handlers/macro/handleDeleteMacro.ts:5-11`:
`describe: () => ({ label: 'Delete Macro' })` — no `inverseAction`.
The undo entry is committed with `inverseAction: null`. Pressing
Cmd+Z silently does nothing; the macro stays deleted; the user has
consumed an undo step.

**Representative files:**

- `src/modules/Command/handlers/macro/handleDeleteMacro.ts:5-11`
- `src/modules/Command/useCases/macro/management/deleteMacro.ts:3-12` (the use case has access to the deleted macro pre-deletion)

**Needed:** Either (a) snapshot the macro in `describe(action)` before
execute and emit a synthetic `restoreMacro` action — but that requires
a new AppAction. Or (b) flip `undoable: false` and document that macro
deletion is irreversible. (b) is cheaper; (a) is what the user expects.
Add a test that asserts undoing `deleteMacro` restores the macro.

### 5. `switchBranch` does not traverse the undo tree

**Problem:** `useCases/undoTree/branchOperations/switchBranch.ts:3-22`
only updates `node.activeBranch`. Does not change `tree.currentNodeId`,
does not invoke any inverse / forward actions, does not touch
`undoStore`. The user "switches branch" and the document is
unchanged.

**Representative files:**

- `src/modules/Command/useCases/undoTree/branchOperations/switchBranch.ts:3-22`
- `src/modules/Command/models/UndoTree.ts:50-79` (no traversal helper)

**Needed:** Implement real traversal: from `tree.currentNodeId`,
walk up to the LCA with the target branch's leaf, dispatching
inverse actions in reverse order. Then walk down to the target leaf,
dispatching forward actions. Update `currentNodeId`. Mirror the
state into `undoStore.past` / `.future` (or accept that they're
out-of-sync when the tree is enabled — but document it). Add a test
that creates a 3-node fork, switches branches, and verifies the
final state matches the target leaf's expected document state.

### 6. Undo of a grouped action races with `undoStore.set`

**Problem:** `useCases/undoRedo.ts:22-48`: `undo()` snapshots
`state.past` at line 23, awaits each inverse via
`runExecuteAppAction(entry.inverseAction)` *with no options*, then
sets `undoStore.set({ past: newPast, … })` based on the original
snapshot. Each inverse goes through `executeAppAction` with default
`skipUndo: false`, so each pushes its own undo entry mid-loop. After
the loop, `undoStore.set(...newPast...)` truncates back to the
snapshot, silently dropping the new entries. Under normal use this
is invisible because the inverse actions land in the same `past`
that's about to be overwritten — but if the inverse triggers any
*other* writer (a CRDT change → reactive action), state is lost.

**Representative files:**

- `src/modules/Command/useCases/undoRedo.ts:22-57`
- `src/modules/Command/useCases/executeAppAction.ts:58-88` (default `skipUndo: false`)

**Needed:** `executeUndo` / `executeRedo` should pass `{ skipUndo: true }`
to `runExecuteAppAction`. Optionally add an in-flight guard
(`let undoing = false; if (undoing) return;`) to prevent overlapping
keypress-driven undos.

### 7. `undoToIndex` overshoots into groups

**Problem:** `useCases/undoRedo.ts:76-98`: targets array index, then
loops `undo()`. If the target is inside a group, the first `undo()`
pops the entire group; subsequent iterations pop additional non-group
entries; the user lands further back than intended. The
UndoHistoryPanel uses this for click-to-jump, so the bug is
user-facing.

**Representative files:**

- `src/modules/Command/useCases/undoRedo.ts:76-98`
- `src/modules/Command/presentations/views/UndoHistoryPanel.tsx:33-35`

**Needed:** Change `undoToIndex` to compute the *count of group
boundaries* between current and target rather than the raw entry
delta. Or add a `goToEntry(entryId)` that does the right thing for
groups.

### 8. `recordAction` records undo's inverse actions

**Problem:** `useCases/macro/recording/recordAction.ts` is invoked
by `executeAppAction`. `undoRedo.ts:40` calls
`runExecuteAppAction(entry.inverseAction)` — which goes through
`executeAppAction` and therefore through `recordAction`. If the
user is recording a macro and presses Cmd+Z, the inverse action
gets appended to `currentRecording`. Stop the macro, replay it,
and the inverse fires as a normal step.

**Representative files:**

- `src/modules/Command/useCases/macro/recording/recordAction.ts:11-23`
- `src/modules/Command/useCases/undoRedo.ts:40,68`
- `src/modules/Command/useCases/executeAppAction.ts:55-56`

**Needed:** Add an `executeAppAction({ skipUndo, source })` flag —
`source: 'undo' | 'redo'` — that `recordAction` checks and skips.
Or pass a flag through `executeUndo` / `executeRedo` that signals
"this is a replay / undo" and have `executeAppAction` skip the
`recordAction(action)` call. Add a test that records a macro,
performs an undo, stops recording, and asserts the macro contains
only the original action.

### 9. CommandPalette / shortcutStore parallel sources of truth

**Problem:** `models/commands/*.ts` lists `shortcut: 'Cmd+...'`
strings for display. `shortcutStore.ts` lists actual bindings.
They drift: `editCommands.ts:75` claims `⌘⇧D` for "Deselect All",
but `shortcutStore.ts:296` binds `mod+shift+d` to
`arrangement.duplicateTrack`, and there is no shortcut for
`deselectAllClips` at all. The palette is advertising shortcuts
that don't exist.

**Representative files:**

- `src/modules/Command/models/commands/transportCommands.ts:14-89`
- `src/modules/Command/models/commands/editCommands.ts:14-79`
- `src/modules/Command/stores/shortcutStore.ts:75-423`

**Needed:** Either (a) drop `shortcut` from `CommandEntry` and
derive it at render time from `shortcutStore` by `id` lookup. Or
(b) drive both surfaces from a shared `COMMAND_DEFINITIONS` array
where each entry has both palette metadata and the keyboard binding.
(a) is the cheaper fix.

### 10. `Escape` is bound four ways with confused fallthrough

**Problem:** `transport.stopPlayback` (`shortcutStore.ts:84-91`) is
bound to `['Escape', 'Enter']` and is the FIRST definition matched.
Inside `handleKeydown.ts:227-249`, the `stopPlayback` callback is
contextual: clear ghost / clear selection / stop loop station / stop
transport. `workspace.clearClipSelection` (`shortcutStore.ts:281-291`)
also binds Escape but is unreachable because the first definition
wins. The contextual logic returns `false` (don't preventDefault)
sometimes and `true` other times — see #11.

**Representative files:**

- `src/modules/Command/stores/shortcutStore.ts:84-91,281-291`
- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:227-249`

**Needed:** Remove the dead `workspace.clearClipSelection` entry
or the alias comment. Document the contextual cascade somewhere
testable. Audit whether `Enter` belongs on `transport.stopPlayback`
— almost certainly not. Split into separate definitions if needed.

### 11. `Escape`/`Enter` `preventDefault` inconsistency

**Problem:** `handleKeydown.ts` `stopPlayback` callback returns
mixed signals: `true` for ghost dismiss, `false` for clear selection,
`true` for stop loop station, `false` for stop transport. Pressing
Escape with neither selection nor transport returns `true` (the
default branch, line 247 returns `false`, but the path through
`stopPlayback()` always reaches `return false`).

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:227-249`

**Needed:** Decide once whether Escape should `preventDefault`
across all branches. Document the rationale. The
"`preventDefault` on ghost dismiss but not on clear selection"
asymmetry is unexplained.

### 12. `zoomToSelection` (`'F'`) shortcut is dead

**Problem (corrected):** `shortcutStore.ts:324` binds `defaultKeys:
['F']` to `view.zoomToSelection` with no `shift+` modifier.
`matches()` at `handleKeydown.ts:118-159` does **case-insensitive**
single-char matching (lines 151-155), so the binding `'F'` would in
principle match `event.key === 'f'`. The dead-code chain is actually:

- `view.zoomToFit` (`shortcutStore.ts:314-318`, bound to `['f',
  'mod+shift+f']`) is **listed earlier** in `INITIAL_DEFINITIONS`
  than `view.zoomToSelection` (`:320-326`).
- The outer iteration at `handleKeydown.ts:588-606` returns on the
  **first** match.
- Plain `f` matches `zoomToFit` and the loop returns. `zoomToSelection`
  is never reached for plain `f`.
- For Shift+F (`event.key === 'F'`, `desc.shift === true`), every
  binding requires `desc.shift === false` (`'f'` and `'F'` and
  `'mod+shift+f'` after the modifier-equality check), so nothing
  matches.

Net effect: `zoomToSelection` never fires under any keystroke; the
shortcut is dead. The fix is the same — `'F'` should be `'shift+f'`
— but the audit's prior claim that "uppercase F without shift" is
"impossible on a standard keyboard" was wrong; the actual blocker is
ordering plus modifier-equality enforcement.

**Representative files:**

- `src/modules/Command/stores/shortcutStore.ts:314-326`
- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:118-159,588-606`

**Needed:** Change `'F'` to `'shift+f'`. Add a test that asserts
`zoomToSelection` fires on Shift+F. Also reorder so the more-specific
binding (`shift+f`) wins — but with the fix, the modifier-equality
check makes ordering moot.

### 13. `setEditingTool.payload.tool` is `string` in commandQueries but literal-union in models

**Problem:** Type drift between the two `AppAction` definitions.
`models/AppAction.ts:120` is the safer literal union;
`useCases/commandQueries.ts:117` widens to `string`. Handlers cast
through the latter accept any string — including typos like
`'cuT'` — that the literal-union version would reject.

**Representative files:**

- `src/modules/Command/models/AppAction.ts:120` (`'select' | 'cut' | 'draw' | 'automation' | 'stretch' | 'marquee'`)
- `src/modules/Command/useCases/commandQueries.ts:117` (`string`)
- Same drift on `addChordEvent.payload.quality` and
  `setWarpAlgorithm.payload.algorithm`.

**Needed:** When consolidating per #1, keep the literal-union
forms. Run typecheck and verify all callers conform. Drop any
runtime `normalizeEditingTool` / fallback helpers that exist only
because the type was widened.

### 14. `executeAppAction` casts handler through `any`

**Problem:** `useCases/executeAppAction.ts:27`:
`getHandlerMap()[action.type] as ActionHandler<any> | undefined`.
`stores/handlerRegistry.ts:20`: `Record<string, ActionHandler<any>>`.
The `any` propagates from registration site through dispatch.
AGENTS.md "no `any`".

**Representative files:**

- `src/modules/Command/useCases/executeAppAction.ts:26-31`
- `src/modules/Command/stores/handlerRegistry.ts:19-20`

**Needed:** Define
`type ActionHandlerOf<A extends AppAction> = ActionHandler<A>;`
and a typed lookup `getHandler<A extends AppAction>(action: A):
ActionHandlerOf<A> | undefined`. The lookup uses the same internal
record but narrows the return. Drop the `any` casts and
eslint-disable comments.

### 15. Action-history / macro replay records inverse actions

(See #8 above; this is the user-visible consequence.)

**Problem:** Cross-cuts macro recording (#8) and action history.
`pushActionHistoryEntry` is also called for every `executeAppAction`
that isn't `skipUndo`. So an inverse action dispatched during undo
appears in **both** the macro's `currentRecording` AND the
AiRuntime action history with `source: 'manual'` (the default).
Action-history viewers will show "removeTrack" then "restoreTrack"
then "removeTrack again" for a single user action.

**Representative files:**

- `src/modules/Command/useCases/executeAppAction.ts:60-72`
- `src/modules/Command/useCases/undoRedo.ts:40,68`

**Needed:** Same fix as #8: pass `skipUndo: true` from
`executeUndo` / `executeRedo`, OR thread a `source: 'undo'`
through and have `executeAppAction` skip both `recordAction` and
`pushActionHistoryEntry` for that source.

### 16. `commitPitchEditCommand` exposed in `useCases/index.ts` without a contract

**Problem:** `useCases/pitch/commitPitchEdit.ts` is exported via
`useCases/index.ts:25` but has no AppAction. It bypasses the
dispatch / undo / macro flow and is invoked imperatively. Its
location under `useCases/pitch/` collides with the AudioAnalysis
"pitch detection" naming.

**Representative files:**

- `src/modules/Command/useCases/pitch/commitPitchEdit.ts`
- `src/modules/Command/useCases/index.ts:25`

**Needed:** Either move the file to Arrangement / PianoRoll where
the actual edit lives, OR wrap it in a `commitPitchEdit` AppAction
+ handler so it goes through the dispatcher and gets undo / macro
support. Rename the folder if kept (`useCases/pitchEdit/`).

### 17. `renameMacro` use case has no AppAction

**Problem:** `useCases/macro/management/renameMacro.ts` is exposed
through `useCases/index.ts:16` but there is no `renameMacro`
AppAction. Cannot be invoked from the command palette, AI prompt,
or voice command. Only direct cross-module function calls reach it,
which bypasses macro / undo / action-history.

**Representative files:**

- `src/modules/Command/useCases/macro/management/renameMacro.ts:3-12`
- `src/modules/Command/useCases/index.ts:16`
- `src/modules/Command/useCases/commandQueries.ts:325-329` (no `renameMacro` action)

**Needed:** Add `renameMacro` to the AppAction union, write
`handleRenameMacro` (with a real inverse for undo), and register
it via `getMacroHandlers`. OR drop the export.

### 18. CommandPalette duplicates handler logic for non-AppAction commands

**Problem:** Many `CommandEntry.action` values are
`() => void` callbacks that imperatively dispatch
`executeAppAction(...)` or call use cases directly
(`models/commands/clipCommands.ts:13-118`,
`transportCommands.ts:54-89`). These callbacks are NOT
`recordAction`-recorded if invoked directly, but ARE recorded if
they internally call `executeAppAction`. The callback path also
bypasses the `traceAppAction` ring entirely when the callback
calls a use case directly (e.g.
`copySelectedClip()`). Two parallel "dispatch" paths.

**Representative files:**

- `src/modules/Command/models/commands/clipCommands.ts:18-30,37-44,...`
- `src/modules/Command/models/commands/transportCommands.ts:52-89`
- `src/modules/Command/models/commands/editCommands.ts:14-78`

**Needed:** Convert `() => void` callbacks to `AppAction`s where
possible. For the ones that need dynamic input (selected-id,
prompt), wrap into AppActions whose payload is computed at
dispatch time, and have the palette's `execute(entry)` always go
through `executeAppAction`. The remainder (truly UI-only commands
like "open preferences dialog") should be a third callback shape
that explicitly does not record.

### 19. Pass-through useCases under `keyboardShortcutActions/`

**Problem:** Multiple files re-export Arrangement / Workspace
useCases under the same name with no added behaviour:
`addTrack.ts`, `duplicateTrack.ts`, `duplicateClip.ts`,
`duplicateClipToNextBar.ts`, `clearSolos.ts`,
`zoomToFit.ts`, `zoomToSelection.ts`, `setEditingTool.ts`,
`zoomTracksVertical.ts`. These add five lines of indirection
each.

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/trackShortcuts/addTrack.ts:1-5`
- `src/modules/Command/useCases/keyboardShortcutActions/trackShortcuts/duplicateClip.ts:1-5`
- `src/modules/Command/useCases/keyboardShortcutActions/trackShortcuts/duplicateTrack.ts:1-5`
- `src/modules/Command/useCases/keyboardShortcutActions/trackShortcuts/duplicateClipToNextBar.ts`
- `src/modules/Command/useCases/keyboardShortcutActions/trackShortcuts/clearSolos.ts`
- `src/modules/Command/useCases/keyboardShortcutActions/workspaceShortcuts/setEditingTool.ts`
- `src/modules/Command/useCases/keyboardShortcutActions/workspaceShortcuts/zoomToFit.ts`
- `src/modules/Command/useCases/keyboardShortcutActions/workspaceShortcuts/zoomToSelection.ts`
- `src/modules/Command/useCases/keyboardShortcutActions/trackShortcuts/zoomTracksVertical.ts`

**Needed:** Inline at the call site (`handleKeydown`) or delete
the wrappers and have `handleKeydown` import from
`#/modules/Arrangement/useCases` / `#/modules/Workspace/useCases`
directly. Either is fine; the indirection is the problem.
Cross-reference AudioAnalysis audit issue #14.

### 20. `handleKeydown` is a 632-line file with multiple state machines

**Problem:** Module-level mutable `aiLeaderState`, nested closures,
two unreachable shortcut-iteration loops (#21), inline contextual
cascades. Test surface is wide, regressions hide in unobvious
branches.

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:1-632`

**Needed:** Split into per-concern files: `aiLeaderChord.ts`,
`shortcutMatcher.ts`, `escapeContextCascade.ts`,
`deleteSelectionShortcut.ts`. Each one function. Move
`aiLeaderState` into a small `aiLeaderStore` (createStore) so HMR
and tests can reset it cleanly.

### 21. Two unreachable shortcut-iteration loops

**Problem:** `handleKeydown.ts:519-528` (inside `handleSimpleKeys`)
and `:588-606` (inside `handleKeydown` outer body) both iterate
`shortcutStore.value.definitions` for the same key event.
`handleKeydown` checks first and returns; `handleSimpleKeys` is
called only when `isInput && !mod && !shift && !alt && !repeat`
fall through past the outer loop, but the outer loop's `isInput`
guard uses `def.id === 'workspace.toggleCommandPalette'` as the
sole input-allowed exception — and the outer loop returns on
match. The inner loop is therefore unreachable in the current
call graph.

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:519-528,588-606`

**Needed:** Delete the inner loop. Run the keydown spec to
confirm no regression (or add a spec for "isInput shortcut is
honoured").

### 22. Action labels cover ~47 of ~250 actions

**Problem:** `useCases/actionLabels.ts:8-47` ACTION_LABELS only
maps a fraction of the AppAction union. The fallback returns
`action.type` (camelCase enum) verbatim. UI surfaces (PromptBar,
AiActionHistoryPanel, undo history rows) display
`setMasterGain`, `groupTracks`, `freezeTrack` etc. as raw enum
strings.

**Representative files:**

- `src/modules/Command/useCases/actionLabels.ts:8-47`
- `src/modules/Command/useCases/commandQueries.ts:32-388` (full action set)

**Needed:** Either (a) generate the labels from an exhaustive
type-driven map (`Record<AppActionType, string>` + an exhaustive
test), OR (b) move the user-facing label into each handler's
`describe(action)`. Option (b) is cleaner — `describe` already
returns a label; the macro / undo / history surfaces just need to
prefer it over `ACTION_LABELS[action.type]`. Drop ACTION_LABELS.

### 23. `describeAction` uses `as Record<string, unknown>`

**Problem:** `useCases/actionLabels.ts:54`:
`const param = action.payload as Record<string, unknown> | undefined`.
The discriminated union of payloads should narrow naturally per
`action.type`, but the function takes the generic `AppAction` and
introspects untyped. AGENTS.md "no assertion escapes".

**Representative files:**

- `src/modules/Command/useCases/actionLabels.ts:52-83`

**Needed:** Switch on `action.type` and read each typed payload
shape directly. Or move per-action labelling into handlers (#22).

### 24. Handler registry production duplicate-handler "winner takes all"

**Problem:** `stores/handlerRegistry.ts:24-35`: DEV throws on
duplicate, PROD `logger.warn` and overwrites. A bootstrap-order
regression that registers two handlers for the same action would
silently swap implementations in production but be caught only in
DEV.

**Representative files:**

- `src/modules/Command/stores/handlerRegistry.ts:24-35`

**Needed:** Same behavior in DEV and PROD: throw. Or add a build-time
test that loads the registry and asserts no duplicates. The cost of
"two handlers fight" in prod is much higher than "app fails to start"
in prod.

### 25. Macro persistence is uncoalesced and silent on failure

**Problem:** `stores/macroStore.ts:30-39`: every macro mutation
re-stringifies and writes the entire macros array to localStorage.
`localStorage.setItem` failures (quota exceeded, private mode) are
swallowed silently. Recording a long macro causes O(N) writes for
N actions.

**Representative files:**

- `src/modules/Command/stores/macroStore.ts:30-39`

**Needed:** Coalesce via `queueMicrotask` like `undoStore` does.
Surface `localStorage` failures to the user via `notifyUser` (or
a logger.warn at minimum).

### 26. `undoTreeStore` is not persisted

**Problem:** `stores/undoTree.ts:15-20` uses `createStore` with no
`storage` adapter. After page refresh, the tree is empty while
`undoStore.past` still holds (action) entries. The mirror
invariant breaks across reloads.

**Representative files:**

- `src/modules/Command/stores/undoTree.ts:15-20`
- `src/modules/Command/stores/undoStore.ts:34-36` (does persist)

**Needed:** Either (a) persist the tree similarly. Note callbacks
won't survive — same constraint as `undoStore`. OR (b) on app
boot, replay `undoStore.past` into `undoTreeStore` if the tree is
enabled. (b) avoids dual-persist races.

### 27. `recordToTree` does not retro-fill on toggle-on

**Problem:** `useCases/undoTree/recordToTree.ts:9-13`: when the
tree is disabled, no entries are recorded. Toggling
`undoTreeStore.enabled = true` mid-session gives the user a tree
that contains only entries committed *after* the toggle. No
mechanism replays prior `undoStore.past` into the tree.

**Representative files:**

- `src/modules/Command/useCases/undoTree/recordToTree.ts:9-13`
- `src/modules/Command/useCases/undoTree/toggleUndoTree/toggleUndoTree.ts:3-9`

**Needed:** When toggling on, walk `undoStore.value.past` and
push each into the tree as a single linear chain. (Branching is
new from this point onward.)

### 28. `redo` is not group-aware

**Problem:** `useCases/undoRedo.ts:59-74`: `redo()` operates on
`state.future[0]` only. After undoing a 5-action group with
`undo()` (atomic), `redo()` brings back ONE entry per call. User
must press Cmd+Shift+Z five times.

**Representative files:**

- `src/modules/Command/useCases/undoRedo.ts:59-74`

**Needed:** Mirror the group-aware logic from `undo()`. When
`state.future[0].groupId` is set, walk forward consuming all
consecutive sibling entries, then commit the whole group in one
shot.

### 29. CommandPalette and UndoHistoryPanel re-render on full store changes

**Problem:** `CommandPalette.tsx:15`
`useStore(workspaceStore)?.commandPaletteOpen` reads the entire
workspace store; any mutation re-renders the palette.
`UndoHistoryPanel.tsx:25` `useStore(undoStore, defaultState)`
reads the entire undo store on every push. Cross-reference the
PianoRoll optimisation work (commit `d2c899dce`) — same anti-pattern
here.

**Representative files:**

- `src/modules/Command/presentations/views/CommandPalette.tsx:15`
- `src/modules/Command/presentations/views/UndoHistoryPanel.tsx:25`

**Needed:** Use the selector form
(`useStore(workspaceStore, (s) => s?.commandPaletteOpen ?? false)`)
or a per-field hook. The undo panel is OK because it actually
needs the full state, but its `[...state.past].reverse()` on every
render allocates fresh arrays — fine in practice given panel size,
but worth knowing.

### 30. AGENTS.md "single object param" violations

**Problem:** Multi-arg positional functions where AGENTS.md
mandates a single object param.

**Representative files:**

- `src/modules/Command/useCases/pushUndoEntry.ts:5-10` (`label, undoFn, redoFn, options?`)
- `src/modules/Command/stores/pushUndoEntry.ts:12-17`
- `src/modules/Command/useCases/commandQueries.ts:427-442` (`createUndoEntry(label, action, inverseAction, source)`)
- `src/modules/Command/models/UndoEntry.ts:28-43`
- `src/modules/Command/useCases/commandQueries.ts:444-459` (`createCallbackUndoEntry(label, undoFn, redoFn, source)`)
- `src/modules/Command/models/UndoEntry.ts:45-60`

**Needed:** Refactor each to a single object param. Land alongside
the model-consolidation work in #1 to minimise churn.

### 31. `useCases/index.ts` re-exports types

**Problem:** `useCases/index.ts:6` re-exports
`type AppAction, type ActionHandler` from `commandQueries`, and
`:10` `type ExecuteOptions`, `:22` `type Macro`. AGENTS.md
"Use-case types stay private". Cross-reference AudioAnalysis audit
issue #17.

**Representative files:**

- `src/modules/Command/useCases/index.ts:1-25`

**Needed:** Move the contract types (`AppAction`,
`ActionHandler`) into a `models/` file (per #1, that's where they
should live anyway). Re-export from `models/`'s public surface,
not from `useCases/`. Drop the `type Macro` export from the
recording file and rely on `models/Macro`.

### 32. AI leader chord state is module-global

**Problem:** `handleKeydown.ts:54`: `let aiLeaderState: AiLeaderState
| null = null`. HMR rebuilds the module and resets it. Tests that
race two leader-arms across files share the variable. Two
browser tabs (under SharedWorker / BroadcastChannel scenarios)
collide.

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:50-73`

**Needed:** Move to a small `aiLeaderStore` via `createStore`.
Test resets via `aiLeaderStore.set(null)`.

### 33. Tool-swap `lastDownKey` clobbered without per-key clear

**Problem:** `handleKeydown.ts:617-628` and `handleKeyup.ts:18-23`
share a `toolSwapStore`. Pressing key `1` records
`lastDownKey: '1'`; before the keyup for `1` arrives, pressing
`2` overwrites with `lastDownKey: '2'`. The keyup for `1` no
longer matches and the previous tool is lost; the keyup for
`2` then matches and triggers a swap based on `2`'s previous
tool.

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:617-628`
- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeyup.ts:14-25`

**Needed:** Track tool-swap by *active key* (e.g. a Map<key,
{ time, prevTool }>) so multiple keys-held don't fight. Or
hardcode "only one swap can be active at a time" and ignore
subsequent keydowns.

### 34. `matches()` named-key brittleness

**Problem:** `handleKeydown.ts:147` only special-cases `Space →
' '`. Bindings using `'Esc'` would never match; the codebase
correctly uses `'Escape'` everywhere — but `transportCommands.ts:24`
displays `'Esc'` in the palette. If anyone adds a new binding
in `'Esc'` shape it silently never matches.

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:147`
- `src/modules/Command/models/commands/transportCommands.ts:24` (display text only)

**Needed:** Add a normalisation table (`Esc → Escape`,
`Del → Delete`, `Return → Enter`, `Up → ArrowUp`, etc.). Or
restrict bindings to `event.key`-canonical strings only and
document.

### 35. No tests for shortcut conflict detection

**Problem:** Issues #10, #12, #16 above all reduce to "two
definitions resolve to the same `(key, mod, shift, alt)` tuple
and the iteration order silently picks one". A linter test that
walks `INITIAL_DEFINITIONS`, normalises each combo, and asserts
no two share a tuple (modulo a documented allow-list of contextual
aliases) would have caught all three.

**Representative files:**

- (test file would be new, e.g. `stores/__tests__/shortcutConflicts.spec.ts`)

**Needed:** Write the test. Add it to CI.

### 36. No test for "every AppAction has a registered handler"

**Problem:** The `AppAction` union is the contract. The handler
registry is filled at bootstrap. Nothing asserts that every action
type has a handler. Adding a new `AppAction` variant without
registering its handler results in `executeAppAction.ts:29`
`logger.error` at runtime — silent for any user not watching the
console.

**Representative files:**

- `src/modules/Command/useCases/executeAppAction.ts:27-31`
- `src/modules/Command/stores/handlerRegistry.ts:36-39`

**Needed:** A test that boots the app's
`registerDependencies` (or a slimmed-down variant), reads
`getHandlerMap()`, and asserts every `AppAction['type']` is a
key. Type-level assertion via
`type Missing = Exclude<AppAction['type'], keyof HandlerMap>` (= `never`)
also catches it at compile time.

### 37. Macro replay does not pass `skipUndo` to wrapped actions

**Problem:** `useCases/macro/playback.ts:23` dispatches each
recorded action via `executeAppAction(action, { groupId, groupLabel })`.
`skipUndo` is NOT set, so each action commits its own undo entry
under the macro's group. Replaying a 5-action macro creates 5 new
undo entries (grouped). Combined with #28 (redo not group-aware),
undoing the macro takes one Cmd+Z (group atomic), redoing takes
five.

**Representative files:**

- `src/modules/Command/useCases/macro/playback.ts:21-25`
- `src/modules/Command/useCases/undoRedo.ts:59-74` (redo not group-aware)

**Needed:** Either wrap the macro-replay in a single
"playMacro" undo entry (callback that re-plays via `skipUndo:
true`), OR fix #28 so redo is group-aware.

### 38. `stores/executeAppAction.ts` is a 3-line re-export proxy of a use case

**Problem:** `stores/executeAppAction.ts` (3 lines) does:

```ts
import { executeAppAction as runExecuteAppAction } from '../useCases/executeAppAction';
export const executeAppAction = runExecuteAppAction;
```

It is **not** a store — it holds no state, it is a use case alias.
Sits in `stores/` solely to satisfy some import path. Searching the
codebase shows it is unreferenced from outside the same folder; it is
dead code. Its existence makes the audit reader think Command has two
parallel `executeAppAction` implementations when it has one.

**Representative files:**

- `src/modules/Command/stores/executeAppAction.ts:1-3`

**Needed:** Delete. Verify no importer references
`#/modules/Command/stores/executeAppAction`. Confirm typecheck passes.

### 39. `models/AppAction` is imported across module boundaries

**Problem:** AGENTS.md is explicit: `models/` is **strictly private**
to the owning module. The cross-module contract is the barrel
(`#/modules/Command/useCases`). But two non-Command modules import
`models/AppAction` directly:

- `src/modules/Workspace/presentations/hooks/usePromptExecution.ts:20`
  — `import { type AppAction } from '#/modules/Command/models/AppAction';`
- `src/modules/AiGeneration/handlers/generation/createGenerationHandler.ts:2`
  — same.

The `useCases/index.ts:6` barrel does export `type AppAction` from
`commandQueries`, so these imports are gratuitously deep — they hit a
private path when a public one is two folders away. This is also the
exact import path that drifts from `commandQueries`'s `AppAction`
(literal-union vs `string`, see #13). Workspace's prompt execution
gets the safer payload types; everyone going through the barrel gets
the loose ones — type behaviour depends on import path.

**Representative files:**

- `src/modules/Workspace/presentations/hooks/usePromptExecution.ts:20`
- `src/modules/AiGeneration/handlers/generation/createGenerationHandler.ts:2`
- `src/modules/Command/useCases/index.ts:6` (the public re-export
  these files should be using)

**Needed:** Replace both imports with
`import { type AppAction } from '#/modules/Command/useCases'`. Add a
dep-cruiser rule that forbids `#/modules/<X>/models/...` from
outside `<X>/`. Consolidate per #1 so the literal-union version is
the only one that exists.

### 40. Command/useCases/commandQueries imported deep from 11+ external modules

**Problem:** `commandQueries.ts` is a **non-barrel file** inside
`useCases/`. AGENTS.md: "Cross-module imports MUST only target the
destination module's root `index.ts`" — and the barrel-policy
section narrows that to `useCases/`-as-barrel. Importing
`#/modules/Command/useCases/commandQueries` from outside Command
violates the same rule that forbids importing
`#/modules/Command/handlers/...`. Yet the codebase does this from at
least 11 external modules to grab `ActionHandler` and `AppAction`:

- `#/utils/createHandler.ts:1-5`
- `Collaboration/useCases/getCollaborationHandlers.ts:1`
- `CrdtDocument/useCases/getDsoSnapshotHandlers.ts:1`
- `MIDI/useCases/getPatternInstanceHandlers.ts:1`
- `MIDI/useCases/getChordTrackHandlers.ts:1`
- `MIDI/useCases/getMidiNoteTransformHandlers.ts:1`
- `AudioAnalysis/useCases/getAnalysisHandlers.ts:1`
- `Project/useCases/getVersionControlHandlers.ts:1`
- `AiGeneration/useCases/getGenerationHandlers.ts:1`
- `AiGeneration/useCases/getAiMidiHandlers.ts:1`
- `Automation/useCases/getAutomationHandlers.ts:1`

The `useCases/index.ts:6` barrel already exports the same types. Every
one of these deep imports is gratuitous and bypasses the contract
boundary.

**Representative files:**

- (the 11 files listed above)
- `src/modules/Command/useCases/commandQueries.ts` (the deep target)
- `src/modules/Command/useCases/index.ts:6`

**Needed:** Replace every cited import with
`from '#/modules/Command/useCases'`. Add a dep-cruiser rule
forbidding `#/modules/<X>/useCases/<file>` from outside `<X>/` (only
the `useCases` folder itself is the barrel). This must land
alongside #1 to keep the literal-union types intact during
consolidation.

### 41. Command module has no root `index.ts` barrel

**Problem:** `src/modules/Command/` has **no root `index.ts`**.
AGENTS.md: "Cross-module imports MUST only target the destination
module's root `index.ts`". External callers therefore cannot import
from `'#/modules/Command'` — they always reach into one of the
sub-barrels (`stores`, `useCases`, `presentations/views`). This
contradicts the documented contract surface and means Command
doesn't have a single import path; cross-module callers pick one of
three. `bootstrap.ts:36-37` even imports from both `stores` and
`useCases` for the same module.

A root barrel that re-exports the legitimate cross-module surface —
`executeAppAction`, `undo`, `redo`, `describeAction`,
`get<Module>Handlers`, `commandPaletteOpen`-style hooks, the
`useGlobalKeyboardShortcuts` hook, `pushUndoEntry`, `macroStore`,
`shortcutStore`, `undoStore` — does not exist. Other modules
(Arrangement, Workspace, MIDI) all have one.

**Representative files:**

- (file does not exist) `src/modules/Command/index.ts`
- `src/app/bootstrap.ts:36-37` (imports both
  `#/modules/Command/stores` and `#/modules/Command/useCases`)

**Needed:** Add `src/modules/Command/index.ts` re-exporting from
`useCases`, `stores`, and `presentations/views`. Migrate external
callers onto it (mechanical search-and-replace, but per the "no
automated bulk edits" rule do this manually). Keep the sub-barrels
as second-tier surfaces only if dep-cruiser allows. Cross-reference
AGENTS.md's "Cross-module — relative imports" section.

### 42. `MacrosPanel.tsx` calls Command use cases directly, bypassing dispatch

**Problem:**
`src/modules/Workspace/presentations/views/Sidebar/MacrosPanel.tsx`
imports `playMacro`, `deleteMacro`, `renameMacro` from
`'#/modules/Command/useCases'` and invokes them directly:

- `:58` — `renameMacro(editingId, editName.trim())`
- `:168` — `onClick={() => playMacro(macro.id)}`
- `:189` — `onClick={() => deleteMacro(macro.id)}`

`playMacro` and `deleteMacro` *have* AppActions (`playMacro`,
`deleteMacro`); the panel could go through `executeAppAction` and
get tracing, semantic-context, action-history, and (for
`deleteMacro`) undo support. `renameMacro` has no AppAction (#17).
The panel has chosen the most invasive path: every macro action
silently bypasses the entire command pipeline. AI prompt that says
"play macro X" goes through the dispatcher and fires `recordAction`,
`pushActionHistoryEntry`, undo recording. Click "play" in the panel
and none of that happens.

**Representative files:**

- `src/modules/Workspace/presentations/views/Sidebar/MacrosPanel.tsx:21-23,58,168,189`
- `src/modules/Command/useCases/index.ts:15-18` (the exposed surface
  that allowed this — see #43)

**Needed:** Route every macro UI action through `executeAppAction`.
For `renameMacro`, add the missing AppAction first (#17). Drop the
direct re-exports of `playMacro`/`deleteMacro` from the Command
barrel — exposing them is what allowed the bypass.

### 43. `useCases/index.ts` re-exports use cases that have AppActions

**Problem:** Once an action has an AppAction and a handler, the
canonical invocation path is `executeAppAction`. Re-exporting the
underlying use case from the cross-module barrel actively encourages
callers to skip dispatch (see #42). Current barrel exports:

- `:15` `deleteMacro` — has `deleteMacro` AppAction, redundantly
  exposed.
- `:18` `playMacro` — has `playMacro` AppAction, redundantly exposed.
- `:20-21` `startMacroRecording`, `stopMacroRecording` — both have
  AppActions, both exposed (and `MacrosPanel` doesn't currently use
  them, but the surface is wide-open).
- `:25` `commitPitchEditCommand` — no AppAction (#16), but
  exposing a use case across modules without a contract path is
  exactly the leak this section is about.

The handler-only contract surface should be `executeAppAction`
plus `get<Module>Handlers`. Direct use-case exposure for things
that already have a dispatch path is a footgun.

**Representative files:**

- `src/modules/Command/useCases/index.ts:15-25`
- `src/modules/Workspace/presentations/views/Sidebar/MacrosPanel.tsx`
  (the consumer that used the leak)

**Needed:** Drop `deleteMacro`, `playMacro`, `startMacroRecording`,
`stopMacroRecording` from the barrel. Keep `renameMacro` until #17
is fixed (then drop it too). For `commitPitchEditCommand`, see #16.

### 44. AI leader chord dispatches without `void`/`await`, swallowing rejections

**Problem:** `dispatchAiChord` in `handleKeydown.ts:75-99` calls
`executeAppAction(...)` four times **without** `void` and **without**
`await`. `executeAppAction` is async; an unhandled promise rejection
disappears into the void. If `generateDrumPattern`'s handler throws
(LLM 502, model not loaded, OOM), the user gets nothing — no toast,
no log, no recovery — and the AI leader chord state has already been
disarmed.

Compare the same file's `executeShortcutAction` at lines 209, 217,
222 which *do* prefix with `void executeAppAction(...)`. The
inconsistency is the bug: the linter/typecheck doesn't enforce
`void`-or-`await` on a returned Promise.

**Representative files:**

- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:78-94`

**Needed:** Add `void` (or `await` and make `dispatchAiChord` async)
to each of the four calls. Add a TS rule
(`@typescript-eslint/no-floating-promises`) if it isn't on. Pipe
errors through `notifyUser` — a failed AI chord should at least
toast.

### 45. `undoStore.loadFromSession` casts through `as UndoEntry` for legacy entries

**Problem:** `stores/undoStore.ts:19-21`:

```ts
function ensureKind(event: UndoEntry): UndoEntry {
    return { ...event, kind: event.kind ?? 'action' } as UndoEntry;
}
```

`event` is typed as `UndoEntry` (a discriminated union on `kind`),
but the function exists because old session payloads may not have a
`kind` field. The `as UndoEntry` is an assertion escape — the
function presumes any `kind`-less legacy entry is `'action'`-shaped,
but `UndoEntry`'s `'callback'` variant has runtime fields
(`undo: () => void`, `redo: () => void`) that JSON cannot round-trip.
Old callback entries restored from session storage will be missing
those functions, and the cast hides it. AGENTS.md "no `as` to
silence type errors" + the soundness rule directly.

Also at line 17: `JSON.parse(raw) as UndoStoreState` — same pattern
without runtime validation. A malformed sessionStorage payload
(injected by another tab, corrupted by a browser update) lands in
the store as if it were valid.

**Representative files:**

- `src/modules/Command/stores/undoStore.ts:17,19-21`

**Needed:** Replace with a Zod schema that validates each entry,
discards malformed ones, and logs a warning. The "default to action"
fallback is silently lossy — drop it and require `kind` to be
present (it has been required for ≥ N commits; legacy data is no
longer worth supporting).

### 46. `recordToTree` only fires on push, never on undo movement

**Problem:** `useCases/undoTree/recordToTree.ts:9-18` is invoked from
`commitUndoEntry` / `pushUndo` paths whenever a NEW entry is
committed. **It is never invoked when `undo()` or `redo()` change
the user's effective position.** The tree's `currentNodeId` thus
points to whichever node was last *pushed*, not where the user
currently is.

After `push(A) → push(B) → push(C) → undo() → undo() → execute(D)`:

- `undoStore.past` contains `[A, D]` (because `pushUndo` clears
  `future`, `undoStore.ts:80-83`).
- `undoTreeStore`'s `currentNodeId` was last set to `D` when `D` was
  pushed — but the parent of `D` was set from `tree.currentNodeId`
  *at the time of D's push*, which was still `C` because no `undo()`
  call ever updated `currentNodeId`.
- So in the tree, `D`'s parent is `C`, not `A`. The tree thinks the
  user did `A → B → C → D`, but the actual reality is `A → D`.

The "branching undo" feature is fundamentally broken: the tree
doesn't track branches at all, it tracks push order. Combined with
`switchBranch` (#5) which doesn't traverse, **the entire undo-tree
feature is decorative**.

**Representative files:**

- `src/modules/Command/useCases/undoTree/recordToTree.ts:9-18`
- `src/modules/Command/useCases/undoRedo.ts:22-74` (does not call
  any tree update on undo/redo)
- `src/modules/Command/models/UndoTree.ts:50-79` (`pushToTree` always
  treats `currentNodeId` as the parent without knowing whether
  undo/redo moved it)

**Needed:** On `undo()` and `redo()`, walk `tree.currentNodeId` up
or down through the tree as well as mutate `undoStore.past`. When a
new entry is pushed after an undo, the tree must already be at the
correct ancestor so `pushToTree` creates a sibling (branch). This
is a substantial rewrite of `recordToTree` + an `undoTreeMoveTo`
useCase. Pair with #5 and #46 in one branching-undo spec.

### 47. `pushUndo` clears `future`, but undo's group loop snapshots `state.future`

**Problem:** `stores/undoStore.ts:75-84` `pushUndo` always sets
`future: []`. The `undoRedo.ts:43-46` group-undo finalizer does:

```ts
undoStore.set({ past: newPast, future: [...groupEntries, ...state.future] });
```

`state.future` here is the snapshot taken at `:23`. During the
inverse loop (`:39-41`), each `executeUndo → executeAppAction` may
itself dispatch further actions through `executeAppAction`, each of
which pushes a new entry (because `skipUndo` is not threaded through;
see #6). Each of those pushes calls `pushUndo`, which clears
`future`. The snapshot at `:23` is therefore **stale by the time
the finalizer runs**: any redo entries that the user had at the
start of the undo are already gone, but the finalizer reinserts the
empty snapshot's `state.future` (i.e., the empty post-undo future
the user had right before this `undo()` call started — actually
wait, `state.future` is the future *before* the inverses fired, so
it's restored from snapshot). The bug: `state.future` is whatever
was in `future` before the `undo()` call started (could be
non-empty if the user had pressed Cmd+Z multiple times). The
inverses' own pushes wipe it. The finalizer **restores** it from
snapshot. So `future` is non-corrupted at the end — but `past`
was clobbered mid-loop (entries appended by inverses, then truncated
by `:43`'s `newPast`).

Net effect when an inverse triggers another `executeAppAction`:
those new entries sit in `past` mid-loop, then are silently dropped
by the finalizer's `slice(0, index + 1)`. The user lost
push-during-undo entries.

**Representative files:**

- `src/modules/Command/stores/undoStore.ts:75-84`
- `src/modules/Command/useCases/undoRedo.ts:22-57`

**Needed:** Same fix as #6: thread `skipUndo: true` into the
inverses. Optionally make `undo()` / `redo()` re-read
`undoStore.value` after each await rather than relying on the
snapshot — the snapshot is stale by definition for any inverse
that has side effects on the store.

### 48. `commitPitchEditCommand` uses `console.error` and bare try/catch

**Problem:**
`useCases/pitch/commitPitchEdit.ts:117-119`:

```ts
} catch (error) {
    console.error('Failed to commit pitch edit:', error);
}
```

- Bypasses `#/infra/logger/appLogger`. The user-feedback memory
  rule "code should self-explain — comments signal hacks; no
  fallback hacks" applies: a try/catch that swallows the failure
  to a console.error is exactly the "fix the root cause" anti-pattern.
- AGENTS.md specifies `notifyUser` for user-actionable failures.
  Pitch-edit commits are user-initiated; failure should toast.
- `redoFn()` runs **inside** the try (line 113), so a partial
  state mutation can occur before the throw. The catch logs and
  exits, but the trackStore has already been updated to the new
  fileId that doesn't exist on disk.

Also, `commitPitchEditCommand(clipId, segments, contour)` takes
three positional args (line 53-57) — AGENTS.md "single object
param" violation, same family as #30.

**Representative files:**

- `src/modules/Command/useCases/pitch/commitPitchEdit.ts:53-119`

**Needed:** Replace `console.error` with `logger.error` and
`notifyUser`. Run `redoFn()` only after the IPC/wasm call succeeds
(currently lines 67-83 run before the redoFn at line 113). Convert
to single object param. Cross-reference #16 — this whole file is on
the chopping block anyway.

### 49. Command palette uses `window.prompt` for rename inputs

**Problem:** Two palette commands open native browser prompts:

- `models/commands/trackCommands.ts:73` —
  `const name = window.prompt('New track name:');`
- `models/commands/clipCommands.ts:25` —
  `const name = window.prompt('Rename clip:', clip?.name ?? '');`

`window.prompt` blocks the event loop, looks like the early-2000s
web, has zero theming, no validation, and is disabled in some
browser contexts (sandboxed iframes, app-mode chrome). DAW UX
expects an inline rename or modal dialog. The audit's **palette is a
keyboard-first UX surface** — popping a native prompt undoes the
rationale.

**Representative files:**

- `src/modules/Command/models/commands/trackCommands.ts:70-79`
- `src/modules/Command/models/commands/clipCommands.ts:20-30`

**Needed:** Either (a) emit an event the dialog/inline rename
component listens for (the panel-toggle openExportDialog /
openPreferencesDialog pattern already exists at
`handleKeydown.ts:313-318`), or (b) add `renameTrack` /
`renameClip` AppActions whose handlers open the dialog and dispatch
a follow-up action with the typed name. (a) is the cheaper
intermediate.

### 50. `macroStore` has no entry cap; localStorage write is full-array stringify

**Problem:** `stores/macroStore.ts:30-39` writes `JSON.stringify(state.macros)`
on every mutation. There is no cap on `state.macros.length` and
no cap on individual macros' `actions[]` length. Recording one
1,000-step macro inflates `state.macros[0].actions` to 1,000 entries
× ~100 bytes each ≈ 100 KB. Stop recording, the panel writes 100 KB.
Record another 1,000-step macro and the panel writes 200 KB —
because the *entire* `macros` array is restringified for each push.

`stores/undoStore.ts:6` has `MAX_UNDO_PERSIST = 100` for exactly
this reason. `macroStore` does not.

Also: each push **during recording** writes localStorage too (the
subscriber doesn't gate on `recording`). Recording mid-flight
pummels localStorage with N writes for N actions, each
re-stringifying every saved macro plus the in-flight one.

**Representative files:**

- `src/modules/Command/stores/macroStore.ts:26-39`

**Needed:** (a) Coalesce via `queueMicrotask` like `undoStore` does
(#25). (b) Add a `MAX_MACRO_ACTIONS` cap and a `MAX_MACROS` cap.
(c) Skip the persistence write while `state.recording === true`;
only persist on stop / delete / rename.

### 51. `undoStore.loadFromSession` defaults entries to `kind: 'action'`

**Problem:** Already covered by #45; reiterating the
forward-compat angle. Old sessionStorage payloads from versions of
the app that lacked `kind` end up with `kind: 'action'` injected
even if they were structurally callback entries (i.e., they had
`undo`/`redo` fns — except those JSON-serialized as
`undefined`-ish, so `kind: 'action'` was probably correct for
all legacy data). **But:** the `as UndoEntry` cast never validates
that `inverseAction` is an `AppAction`. A persisted
`inverseAction.type` of `'someRemovedActionType'` (because the
shipped AppAction union dropped it between releases) replays as
`logger.error('No handler registered for action: someRemovedActionType')`
on next undo. No graceful recovery.

**Representative files:**

- `src/modules/Command/stores/undoStore.ts:14-32`
- `src/modules/Command/useCases/executeAppAction.ts:28-31`

**Needed:** Validate persisted action types against the live
`AppAction['type']` set on load. Drop entries whose type is unknown.
Surface the count to the user ("3 entries from a previous session
were discarded because they referenced removed actions").

### 52. `editCommands.ts:75` and `trackCommands.ts:45` both display `⌘⇧D`

**Problem:** Two palette entries advertise the same shortcut to the
user. Only one (`arrangement.duplicateTrack` via `mod+shift+d`)
actually fires. `deselect-all` (`editCommands.ts:71-79`) shows
`⌘⇧D` but the `shortcutStore` does not bind that combo to it. So:

- The Edit category palette row shows "Deselect All ⌘⇧D".
- The Track category palette row shows "Duplicate Track ⌘⇧D".
- Pressing Cmd+Shift+D triggers Duplicate Track.
- Clicking "Deselect All" in the palette works (because the entry
  has its own `() => void` action), but the displayed shortcut is
  a lie.

Cross-reference #18.

**Representative files:**

- `src/modules/Command/models/commands/editCommands.ts:71-79`
- `src/modules/Command/models/commands/trackCommands.ts:40-52`
- `src/modules/Command/stores/shortcutStore.ts:293-298`

**Needed:** Same as #9 — derive `shortcut` from `shortcutStore`
by id at render time. As an interim, drop the lying string from
`editCommands.ts:75`.

### 53. `Backspace` and `Delete` shortcut bypasses input gating

**Problem:** `shortcutStore.ts:163-171` binds
`editing.deleteSelection` to `['Delete', 'Backspace']`. The outer
loop in `handleKeydown.ts:588-606` continues past inputs (the
`isInput && !allowedInInput` continue at `:593-595`). `'Delete'`
and `'Backspace'` are NOT in the `allowedInInput` allow-list (only
`workspace.toggleCommandPalette` is), so the loop continues past
them when in an input — **but** the panel's outer body then falls
through to `if (isInput) return false;` (`:611-613`), preventing
the deletion. So Backspace in an `<input>` clears the input
character, not the clip selection. 

But: `event.target.isContentEditable` (in
`useGlobalKeyboardShortcuts.ts:10`) treats any contenteditable as
an input. Custom canvas-based editors (PianoRoll, Elastic Editor,
Mixer fader) that have their own focus model and intercept
keyboard themselves are NOT contenteditable, so for them
`isInput === false` and Backspace deletes the clip selection — even
when the user's intent was "delete the selected note in
PianoRoll". Cross-reference: the `keyboard.deleteSelectionShortcut`
inside `handleKeydown.ts:455-510` deletes the *clip*, not the note.

**Representative files:**

- `src/modules/Command/stores/shortcutStore.ts:163-171`
- `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:444-510,592-595`
- `src/modules/Command/presentations/views/keyboardShortcutsContract.ts:10-13`

**Needed:** The keyboard-shortcut layer must know the active
*context* (Arrangement vs PianoRoll vs Mixer). Either route
keyboard events through a per-context handler (PianoRoll registers
its own keydown listener with stopPropagation), OR thread an
"editor context" flag into `KeyDescriptor` and have the
`deleteSelection` callback dispatch the context-appropriate action.
Today this is a latent regression waiting for a user to delete a
note and lose a clip.

### 54. No test catches inverse-action drop during group undo

**Problem:** `__tests__/undoRedo.spec.ts:61-93` mocks
`executeAppAction` as a no-op `vi.fn`. The mock never causes new
entries to land in `undoStore.past`, so the `state.past` snapshot
at `:23` matches the live store at `:43`, and `slice(0, index+1)`
truncates to the same value the live store already had. The race
described in #6 / #45 / #47 is **invisible** to this test by
design.

A correctly-shaped regression test would have `executeAppAction`'s
mock simulate a CRDT subscriber appending to `undoStore.past` mid-
inverse, then assert that those entries are not silently dropped
when the snapshot finalizer runs.

**Representative files:**

- `src/modules/Command/useCases/__tests__/undoRedo.spec.ts:61-93`

**Needed:** Add a test that mocks `executeAppAction` to push a new
`UndoEntry` into `undoStore.past` on each call, then runs `undo()`
on a 3-action group, then asserts every push survived (or, after
the fix, that the inverses ran with `skipUndo: true` and no new
pushes happened).

---

## Open questions

- [ ] Is the parallel `models/AppAction` + `useCases/commandQueries`
      duplication an in-progress migration, or has it been stable
      for many commits? (Determines whether to delete one or
      consolidate.)
- [ ] Does the undo-tree feature ship to users today, or is it
      gated behind a feature flag? (Affects priority of #5 / #26 / #27.)
- [ ] Is `commitPitchEditCommand` hit in production paths? Where is
      it imported from? (Affects whether #16 is a deletion or a
      relocation.)
- [ ] Is there an integration test that covers macro
      record-undo-redo-replay round-trip end-to-end? (Would have
      caught #8, #21, #28, #37.)
- [ ] Are there platform-specific concerns for `mod+t` / `mod+w`
      / `mod+q` interfering with Tauri / browser defaults? (#40
      cross-reference.)

---

## Risks

- **Silent undo breakage.** Issue #4 (`handleDeleteMacro` no inverse),
  #6 (group-undo race), #7 (`undoToIndex` overshoot), #28 (redo not
  group-aware): the user thinks they undid something, but state
  diverges from the visible history. In a DAW where users perform
  hours of work, this erodes trust catastrophically.
- **Macro corruption.** Issue #8 / #21 / #37: a macro recorded
  while the user happened to press Cmd+Z mid-recording contains
  inverse actions. Replaying nukes the user's work. Issue #25:
  macros may silently fail to persist.
- **Branching undo is theatre.** Issue #5: `switchBranch` only
  flips a label. Users who try to use the feature get state-action
  mismatch with no error.
- **Shortcut bindings drift between display and reality.** Issue
  #9 + #12: the command palette advertises shortcuts that don't
  fire; some shortcuts are dead. Users learn keybindings that
  don't work.
- **Type unsoundness in dispatch.** Issue #14: the registry is
  `any`-typed; bugs that cross handler boundaries are caught only
  at runtime.
- **Production silently overwrites duplicate handlers.** Issue
  #24: a bootstrap regression could swap the implementation a user
  gets in production while DEV catches it; PR review depends on
  someone running DEV.
- **Persistent state inconsistency.** Issue #26: undo tree empty
  on refresh while undo store is partial. Issue #27: toggling the
  tree mid-session leaves partial state.

---

## Suggested approaches

- **Consolidation pass first.** Pick `useCases/commandQueries.ts`
  as the canonical model surface (it's the cross-module contract).
  Delete `models/AppAction.ts`, `models/ActionHandler.ts`,
  `models/UndoEntry.ts`. Run typecheck; the literal-union vs
  `string` drift in #13 will fail — fix the production code to
  conform. Move shared types into `models/` per AGENTS.md once
  consolidated. Land in one PR; touches every file but each touch
  is mechanical.
- **Eliminate stores/ vs useCases/ duplicates** (#2). Drop the
  `stores/` versions of `pushUndoEntry`, `clearUndoHistory`,
  `commitActionUndoEntry`, `generateGroupId`. Update barrel.
- **Fix `handleDeleteMacro` + add inverse for grouped undo** (#4,
  #6). Both are small, both fix correctness.
- **Make undo / redo group-aware symmetrically and add a test
  matrix** (#6, #7, #8, #21, #28, #37). One spec sweep covers most
  of these.
- **Implement `switchBranch` traversal or hide the UI** (#5). If the
  feature is not shipping, gate it; if it is shipping, the
  traversal logic is non-trivial and deserves its own spec.
- **Single-source the keyboard bindings + add conflict tests** (#9,
  #12, #16, #18, #35). Drive command palette from
  `shortcutStore` by id; delete the per-command `shortcut`
  field. Add a duplicate-tuple linter test.
- **Delete the unused hook + dead inner loop** (#3, #21). Two
  mechanical deletions.
- **AGENTS.md compliance pass** (#14, #19, #30, #31). Mostly
  mechanical. Combine with #1.

---

## Recommendation

Start with **issue #4 (handleDeleteMacro inverse)** and
**issue #6 (group-undo race + missing skipUndo)** as a paired
correctness fix. Both are small, both touch the same area, both
ship visible behavior changes. Add a regression test that performs
"delete macro → undo" and "grouped action → undo → assert no
extra entries in past".

Next, **issue #1 (consolidate the three model layers)**. This is
mechanical but high-blast-radius; running `pnpm typecheck` will
reveal every drift. Land separately so it can be reverted cleanly
if a downstream module fails.

After those two commits, the next session can choose the
"shortcut conflicts" pass (#9, #12, #16, #18, #35) or the
"undo correctness" pass (#5, #7, #26, #27, #28, #37). They are
independent.

---

## Resolved

_No issues resolved yet._
