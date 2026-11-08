# Standing probes: repeated action rows

## Standing probes

1. **Repeated labels retain every occurrence through an update.** Display labels do not identify action occurrences.
   Render three identical actions followed by a distinct action in both the proposal and its history, then shrink or
   update the lists. Assert row multiplicity, order, and the exact next state, and capture actual React console errors
   to require no duplicate-key warning. Use occurrence identity appropriate to the owning list: position is sufficient
   for stateless rows in an immutable ordered proposal or group. Do not deduplicate actions or mint project IDs to
   make labels unique. Restoring label-only proposal keys and action-type-plus-label history keys must fail the shrink
   or warning assertions in `src/modules/WorkspaceShell/presentations/views/__tests__/AgentWorkspace.spec.tsx`.

## Scope and escape

Apply this probe to presentation lists of actions or other legitimate repeated occurrences, especially where rows
are replaced or removed on a subsequent render. PR #4190 introduced the proposal's label key and PR #4184 introduced
the history's action-type-plus-label key. Unique-label fixtures did not exercise the failure condition: repeated
actions produced duplicate keys, and shrinking a proposal could leave an extra row.
