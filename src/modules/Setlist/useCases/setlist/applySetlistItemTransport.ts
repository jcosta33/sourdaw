import { isAppError } from '#/infra/errors/isAppError';
import { setTempo, setTimeSignature } from '#/modules/Transport/useCases';

import type { SetlistItem } from '../../stores/setlistStore';

function isTempoRampWriteError(error: unknown): boolean {
    return isAppError(error) && error._tag === 'TempoRampWrite';
}

export function applySetlistItemTransport(item: SetlistItem): void {
    if (item.bpm !== null) {
        try {
            setTempo({ bpm: item.bpm });
        } catch (error) {
            if (!isTempoRampWriteError(error)) {
                throw error;
            }
        }
    }

    if (item.timeSignature !== null) {
        setTimeSignature(item.timeSignature.numerator, item.timeSignature.denominator);
    }
}
