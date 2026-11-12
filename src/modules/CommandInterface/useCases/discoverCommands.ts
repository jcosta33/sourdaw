import { type CommandContext } from '../models/CommandContext';
import { type CommandDiscoveryGroup, discoverCommands as discoverCommandEntries } from '../models/CommandSearch';

import { type CallableCommandEntry } from './searchCommandRegistry';

export function discoverCommands(
    registry: CallableCommandEntry[],
    recentIds: readonly string[],
    context?: CommandContext
): CommandDiscoveryGroup<CallableCommandEntry>[] {
    return discoverCommandEntries(registry, recentIds, context);
}
