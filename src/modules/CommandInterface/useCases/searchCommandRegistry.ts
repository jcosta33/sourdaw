import { type AppAction } from '#/utils/handlerContract';

import { type CommandEntry } from '../models/CommandEntry';
import { searchCommands } from '../services/commandSearch';

export type CommandAction = AppAction | (() => void);
export type CallableCommandEntry = CommandEntry<CommandAction>;

export type SearchCommandRegistryInput = {
    registry: CallableCommandEntry[];
    query: string;
};

/**
 * Search the command catalog, withholding entries whose `isAvailable` gate
 * reports their backing resource absent. Entries without a gate are always
 * offered.
 *
 * A gate is run inside a try and compared against `true` because this runs in
 * the palette's render body. A gate that throws would otherwise take the whole
 * palette down — every unrelated command with it — and a gate that returns a
 * Promise is truthy, so it would offer its entry unconditionally, which is the
 * failure this mechanism exists to prevent. Both cases fail closed: a gate that
 * cannot answer is treated as unavailable.
 */
export function searchCommandRegistry({ registry, query }: SearchCommandRegistryInput): CallableCommandEntry[] {
    const available = registry.filter((entry) => {
        if (!entry.isAvailable) {
            return true;
        }
        try {
            return entry.isAvailable() === true;
        } catch {
            return false;
        }
    });

    return searchCommands(available, query);
}
