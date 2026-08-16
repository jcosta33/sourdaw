# ADR 0031: Retire legacy DSO command execution

- Status: Accepted
- Date: 2026-08-03

## Context

Provider-neutral command planning now produces typed runtime actions that cross the strict AiRuntime bridge and execute through Command's AppAction registry. Prompt planning already stops on rejected or empty provider plans, so the older Domain-Specific Operation (DSO) editor has no production caller.

The unreachable subsystem still retained a second mutation architecture: its own schema and logical-state projection, direct multi-action execution, a separate destructive-edit confirmation union, and a whole-document `restoreDsoSnapshot` action used to manufacture batch undo. Runtime engine or event effects could escape before that CRDT-only snapshot restore, so retaining the path conflicts with the common atomic AppAction contract even while dormant.

## Decision

1. Remove the DSO parser, executor, logical-state model, editor state, backend-availability gate, confirmation variant, and their tests.
2. Pending AI confirmations contain only validated AppActions and always carry the complete project revision used to plan them.
3. Remove `restoreDsoSnapshot` from the AppAction registry, handler bootstrap, runtime-action policy, payload validation, and public CrdtDocument snapshot-command surface. Repository-internal snapshot primitives used for transaction reconciliation remain unchanged.
4. Remove JSON-edit result flags from prompt planning. Command UI messages use the ordinary AppAction receipt path and a presentation-only `isCommandAction` marker.
5. Keep the literal retired action name only as a persistence tombstone in undo and macro hydration. Existing browser data containing that action is discarded rather than made executable or cast into the current registry. AI history hydration also rejects legacy groups containing JSON-edit receipts so the UI cannot offer undo for an action that no longer has an executable record.
6. A rejected, malformed, or empty provider plan has no alternate mutation fallback. Adding command coverage requires a typed registry entry and the shared validation, confirmation, Automerge, receipt, and undo path.

This decision supersedes ADR 0019's clause that a complete empty provider plan may enter DSO parsing and ADR 0021's legacy DSO confirmation exception.

## Consequences

- Every executable LLM project mutation has one admission and execution architecture.
- Legacy DSO undo, macro, or AI history records are ignored on hydration; no project-file migration is required because DSO editor state was ephemeral.
- WebLLM and hosted providers retain the same provider-neutral tool-planning boundary.
- Unsupported intent returns a no-match or rejection receipt until its typed AppAction mapping is implemented.
