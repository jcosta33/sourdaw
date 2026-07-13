---
type: bug
id: BUG-prompt-actions-ignore-confirmation
title: Prompt fast-path actions ignore the confirmation flag before execution
status: fixed
owner: The Sourdaw team
sources:
  - .agents/findings/frontend-runtime-writepath-audit-2026-06-27.md
  - SPEC-ai-trust-modes
---

# Bug: Prompt fast-path actions ignore the confirmation flag before execution

## Symptom

The prompt parser can mark parsed actions as requiring confirmation, but the chat execution path immediately executes every returned action.

## Reproduction

1. Confirm destructive actions are classified as confirmation-required:

```text
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/transformers/promptParser/parsing.ts:431:export function requiresConfirmation(actions: RuntimeAction[]): boolean {
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/transformers/promptParser/parsing.ts:434:            alpha.type === 'removeTrack' ||
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/transformers/promptParser/parsing.ts:435:            alpha.type === 'removeClip' ||
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/transformers/promptParser/parsing.ts:436:            alpha.type === 'removeDevice' ||
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/transformers/promptParser/parsing.ts:437:            alpha.type === 'bounceInPlace'
```

2. Confirm `parsePromptToActions` returns that flag:

```text
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/useCases/parsePromptToActions.ts:39:                return {
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/useCases/parsePromptToActions.ts:42:                    requiresConfirmation: requiresConfirmation(validated),
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/useCases/parsePromptToActions.ts:53:                    requiresConfirmation: requiresConfirmation(validated),
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/useCases/parsePromptToActions.ts:64:                    requiresConfirmation: requiresConfirmation(validated),
```

3. Confirm `sendChatMessage` does not branch on `result.requiresConfirmation` before executing:

```text
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/useCases/sendChatMessage.ts:236:                for (const action of result.actions) {
/Users/josecosta/dev/sourdaw/src/modules/AiRuntime/useCases/sendChatMessage.ts:237:                    await executeAppAction(action, { ...group, source: 'prompt' });
```

4. Confirm `requiresConfirmation` is not consumed by another execution gate in `AiRuntime`:

```text
21 matches in 5 files [models/IntentResult.ts, transformers/promptParser/__tests__/parsing.spec.ts, transformers/promptParser/parsing.ts, useCases/__tests__/parsePromptToActions.spec.ts, useCases/parsePromptToActions.ts]
```

**Expected:** if parsed prompt actions require confirmation, shared AI dispatch blocks mutation until explicit user confirmation.
**Actual:** `sendChatMessage` executes the actions immediately.
**Conditions:** Reproduced by source inspection and `rg requiresConfirmation` on 2026-06-27 from the local `sourdaw` working tree.

## Root cause

`requiresConfirmation` is a field on `IntentResult`, but the prompt execution path treats `result.actions` as directly executable and never checks the field.

## Affected requirements

- `SPEC-ai-trust-modes#AC-004` - replace/destructive actions must require explicit confirmation before mutating content.
- `SPEC-ai-trust-modes#AC-005` - enforcement must live in the shared dispatch/execution path, not in one UI surface.
