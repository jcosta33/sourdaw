/**
 * Command registry — aggregates all commands from per-category sub-files.
 *
 * To add a new command: find the relevant sub-file in `./commands/` and add it there.
 * This file owns the `CommandEntry` type, the aggregated `commandRegistry` array,
 * and the `fuzzyMatch` / `searchCommands` utilities.
 */

import { type AppAction } from './AppAction';

export type CommandEntry = {
    id: string;
    label: string;
    description: string;
    category: string;
    shortcut?: string;
    action: AppAction | (() => void);
};

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

// ── Search utilities ───────────────────────────────────────────────────────

export function fuzzyMatch(query: string, text: string): boolean {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            qi++;
        }
    }
    return qi === q.length;
}

export function searchCommands(query: string): CommandEntry[] {
    if (!query.trim()) {
        return commandRegistry;
    }
    return commandRegistry.filter(
        (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.description) || fuzzyMatch(query, cmd.category)
    );
}
