# Standing probes: keyboard actions in interactive rows

An interactive browser row fails when its main action is pointer-only, when sibling actions also trigger it, or
when keyboard focus is hidden by hover-only styling. Probe native controls, their owning state changes, and
rendered focus in Chromium. The component cases live in
`src/modules/ContentBrowser/presentations/views/Sidebar/__tests__/SamplesTab.spec.tsx`; the browser cases live
in `tests/e2e/importedSampleKeyboardAdd.spec.ts`.

## Standing probes

1. **The row's main action is missing from keyboard navigation.** Runs: CI; the reviewer reads the affected
   end-to-end job that runs `importedSampleKeyboardAdd.spec.ts` on the head for the real-Tab case, and runs the
   component mutation itself. In an imported sample row, require a named native Add button separate from
   Preview and Favorite. Start at Preview, use real Tab, and assert the button receives focus. Removing the
   native button or replacing it with a clickable row wrapper must fail the real-Tab browser case and the
   component case under `pnpm guard --profile focused -- pnpm test:run
src/modules/ContentBrowser/presentations/views/Sidebar/__tests__/SamplesTab.spec.tsx`.
2. **Enter or Space does not make one undoable placement while transport stays stopped.** Runs: CI; the
   reviewer reads the affected end-to-end job that runs `importedSampleKeyboardAdd.spec.ts` on the head, and
   from the fixed commit checks that Enter and Space are separate fresh cases. Compare complete matching clip
   objects in raw project authority and its owner projection; require one new `captureUndoHistory()` past
   action with type `addClip`. Confirm the transport still exposes Play. Real Undo must remove the clip from
   both authorities, restore the prior past length, and move `addClip` to future. Removing or duplicating the
   Add handler, or allowing the key to toggle transport, must fail its case (#6287).
3. **Preview or Favorite also triggers Add.** In separate fresh cases, activate Preview and Favorite through
   their own native controls and compare project clips and Undo history before and after. Preview must only
   preview; Favorite must only change favorite state. Dispatching Add from either sibling action must fail
   "keeps Preview and Favorite separate from sample placement" in `SamplesTab.spec.tsx` (#6287, #6272).
4. **Focused actions have no visible focus paint after the pointer leaves.** Runs: CI; the reviewer reads the
   affected end-to-end job that runs `importedSampleKeyboardAdd.spec.ts` on the head, and from the fixed commit
   checks that the case captures with animations disabled and moves the pointer outside the row. Keep focus
   within the same row and reach Add then Favorite with real Tab. Compare a one-pixel inside border strip on Add
   before and after focus; the captured PNG bytes must change. Require Favorite's resolved opacity to remain `1`
   while focused. Removing the inset ring or focus-within visibility must leave the paint or opacity unchanged
   and fail the owning case.
5. **The native Add control breaks pointer click or drag.** Runs: CI; the reviewer reads the affected
   end-to-end job that runs `importedSampleKeyboardAdd.spec.ts` on the head. Use independent fresh
   imported-sample cases: click the visible sample name and require one placement; then start a native drag on
   the Add button and drop on the current audio track's actual timeline row, requiring one canonical
   raw/projected clip and one `addClip` Undo action. The component case "populates dataTransfer with sample
   details including durationSeconds on drag start" keeps the full drag payload. Removing the Add click or
   breaking dragstart on the row must fail its corresponding case (#6287).
