import { type VibeBatchValueSource } from '../../models/VibeBatchValueSource';

import { type VibeBatchValueChoice } from './chooseVibeBatchValues';

/** What the card keeps of a value choice: where its values came from, never the values themselves. */
export function readVibeBatchValueSource(choice: VibeBatchValueChoice): VibeBatchValueSource {
    if (choice.source === 'measurements') {
        return { source: 'measurements' };
    }
    return { source: choice.source, reason: choice.reason, detail: choice.detail };
}
