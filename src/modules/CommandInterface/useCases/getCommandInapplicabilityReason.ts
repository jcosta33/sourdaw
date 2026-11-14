import { type CommandContext } from '../models/CommandContext';
import { getCommandInapplicabilityReason as getInapplicabilityReason } from '../models/CommandSearch';

import { type CallableCommandEntry } from './searchCommandRegistry';

export function getCommandInapplicabilityReason(
    command: CallableCommandEntry,
    context?: CommandContext
): string | null {
    return getInapplicabilityReason(command, context);
}
