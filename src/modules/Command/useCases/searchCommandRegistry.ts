import { searchCommands } from '../services/commandSearch';

import { type CallableCommandEntry } from './commands/commandEntry';

export type SearchCommandRegistryInput = {
    registry: CallableCommandEntry[];
    query: string;
};

export function searchCommandRegistry({ registry, query }: SearchCommandRegistryInput): CallableCommandEntry[] {
    return searchCommands(registry, query);
}
