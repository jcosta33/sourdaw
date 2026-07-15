import { aiCommands } from '../../useCases/commands/AiCommands';
import { automationCommands } from '../../useCases/commands/AutomationCommands';
import { clipCommands } from '../../useCases/commands/ClipCommands';
import { type CallableCommandEntry } from '../../useCases/commands/commandEntry';
import { editCommands } from '../../useCases/commands/EditCommands';
import { elasticCommands } from '../../useCases/commands/ElasticCommands';
import { midiCommands } from '../../useCases/commands/MidiCommands';
import { miscCommands } from '../../useCases/commands/MiscCommands';
import { projectCommands } from '../../useCases/commands/ProjectCommands';
import { trackCommands } from '../../useCases/commands/TrackCommands';
import { transportCommands } from '../../useCases/commands/TransportCommands';
import { viewCommands } from '../../useCases/commands/ViewCommands';
import { searchCommandRegistry } from '../../useCases/searchCommandRegistry';

/**
 * Command registry — aggregates all commands from per-category sub-files.
 *
 * To add a new command: find the relevant sub-file in
 * `../../useCases/commands/` and add it there. The data shape lives in
 * `../../models/CommandEntry.ts`; callable command ownership lives in
 * `../../useCases/commands/commandEntry.ts`. Pure search helpers
 * (`fuzzyMatch`, `searchCommands`) live in `../../services/commandSearch.ts`.
 *
 * This file owns only the aggregation and a thin search wrapper bound to the
 * aggregated catalog. Re-exports the type and helpers so existing in-module
 * consumers (e.g. CommandPalette.tsx) keep working.
 */

// ── Re-exports for in-module consumers ────────────────────────────────────

export type CommandEntry = CallableCommandEntry;

// ── Aggregated registry ────────────────────────────────────────────────────

export const commandRegistry: CallableCommandEntry[] = [
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
export function searchCommands(query: string): CallableCommandEntry[] {
    return searchCommandRegistry({ registry: commandRegistry, query });
}
