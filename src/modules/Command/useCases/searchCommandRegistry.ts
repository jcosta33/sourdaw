import { type AppAction } from '../models/AppAction';
import { type CommandEntry } from '../models/CommandEntry';
import { searchCommands } from '../services/commandSearch';

export type CommandAction = AppAction | (() => void);
export type CallableCommandEntry = CommandEntry<CommandAction>;

export type SearchCommandRegistryInput = {
    registry: CallableCommandEntry[];
    query: string;
};

export function searchCommandRegistry({ registry, query }: SearchCommandRegistryInput): CallableCommandEntry[] {
    return searchCommands(registry, query);
}
