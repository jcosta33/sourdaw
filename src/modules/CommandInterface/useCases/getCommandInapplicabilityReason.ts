import { getCommandInapplicabilityReason as getInapplicabilityReason } from '../models/commandSearch';

import { type CallableCommandEntry } from './searchCommandRegistry';

export function getCommandInapplicabilityReason(command: CallableCommandEntry): string | null {
    return getInapplicabilityReason(command);
}
