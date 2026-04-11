/**
 * Command registry — aggregates all commands from per-category sub-files.
 *
 * To add a new command: find the relevant sub-file in `./commands/` and add it there.
 * The `CommandEntry` type lives in `./CommandEntry.ts`; pure search helpers
 * (`fuzzyMatch`, `searchCommands`) live in `../services/commandSearch.ts`.
 *
 * This file owns only the aggregation and a thin search wrapper bound to the
 * aggregated catalog. Re-exports the type and helpers so existing in-module
 * consumers (e.g. CommandPalette.tsx) keep working.
 */

import { type CommandEntry } from './CommandEntry';
import { searchCommands as searchCommandsImpl } from '../services/commandSearch';

// ── Re-exports for in-module consumers ────────────────────────────────────

export type { CommandEntry } from './CommandEntry';
export { fuzzyMatch } from '../services/commandSearch';

// ── Category sub-modules ───────────────────────────────────────────────────
import { transportCommands } from './commands/transportCommands';
import { editCommands } from './commands/editCommands';
import { trackCommands } from './commands/trackCommands';
import { clipCommands } from './commands/clipCommands';
import { midiCommands } from './commands/midiCommands';
import { aiCommands } from './commands/aiCommands';
import { automationCommands } from './commands/automationCommands';
import { projectCommands } from './commands/projectCommands';
import { viewCommands } from './commands/viewCommands';
import { miscCommands } from './commands/miscCommands';

// ── Aggregated registry ────────────────────────────────────────────────────

export const commandRegistry: CommandEntry[] = [
    ...transportCommands,
    ...editCommands,
    ...trackCommands,
    ...clipCommands,
    ...midiCommands,
    ...aiCommands,
    ...automationCommands,
    ...projectCommands,
    ...viewCommands,
    ...miscCommands,
];

/** Search the aggregated catalog. */
export function searchCommands(query: string): CommandEntry[] {
    return searchCommandsImpl(commandRegistry, query);
}
