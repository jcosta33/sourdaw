import { type CommandDiscoveryGroup, discoverCommands as discoverCommandEntries } from '../models/CommandSearch';

import { type CallableCommandEntry } from './searchCommandRegistry';

export function discoverCommands(
    registry: CallableCommandEntry[],
    recentIds: readonly string[]
): CommandDiscoveryGroup<CallableCommandEntry>[] {
    return discoverCommandEntries(registry, recentIds);
}
