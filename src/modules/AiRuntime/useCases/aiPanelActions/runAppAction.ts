import { executeAppAction } from '#/modules/Command/useCases';

// AiRuntime-local shape (AGENTS.md §95 — derive from Command's public use-case signature
// rather than importing the AppAction union directly). Passed through opaquely.
type AppAction = Parameters<typeof executeAppAction>[0];

export function runAppAction(action: AppAction): Promise<void> | void {
    return executeAppAction(action);
}