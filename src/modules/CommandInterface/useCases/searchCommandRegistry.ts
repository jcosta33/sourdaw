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
 */
export function searchCommandRegistry({ registry, query }: SearchCommandRegistryInput): CallableCommandEntry[] {
    const available = registry.filter((entry) => {
        if (!entry.isAvailable) {
            return true;
        }
        return entry.isAvailable();
    });

    return searchCommands(available, query);
}
