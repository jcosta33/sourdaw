import { searchCommands as searchCommandsImpl } from '../services/commandSearch';

import { type CommandEntry } from './CommandEntry';
import { aiCommands } from './Commands/AiCommands';
import { automationCommands } from './Commands/AutomationCommands';
import { clipCommands } from './Commands/ClipCommands';
import { editCommands } from './Commands/EditCommands';
import { elasticCommands } from './Commands/ElasticCommands';
import { midiCommands } from './Commands/MidiCommands';
import { miscCommands } from './Commands/MiscCommands';
import { projectCommands } from './Commands/ProjectCommands';
import { trackCommands } from './Commands/TrackCommands';
import { transportCommands } from './Commands/TransportCommands';
import { viewCommands } from './Commands/ViewCommands';

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

// ── Re-exports for in-module consumers ────────────────────────────────────

export type { CommandEntry } from './CommandEntry';
export { fuzzyMatch } from '../services/commandSearch';

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
    ...elasticCommands,
];

/** Search the aggregated catalog. */
export function searchCommands(query: string): CommandEntry[] {
    return searchCommandsImpl(commandRegistry, query);
}
