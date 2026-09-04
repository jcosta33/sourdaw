export function getProjectCommitFinalizationWarning(reason: string): string {
    return `The project change is durably committed, but its finalization evidence is unavailable: ${reason}. Do not replay these actions. Inspect the current project state before further automation.`;
}
