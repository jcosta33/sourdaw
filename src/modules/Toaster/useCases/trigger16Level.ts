import { MAX_AUDIBLE_FREQ_HZ, MIN_AUDIBLE_FREQ_HZ } from '#/utils/audioSpectrum';

import { TOASTER_PAD_COUNT } from '../models/ToasterKit';

import { get16LevelsTarget } from './get16LevelsTarget';
import { setPadParamImmediate } from './setPadParamImmediate';
import { triggerToasterPad } from './triggerPad';

export function trigger16Level(gridIndex: number, deviceId: string): void {
    const session = get16LevelsTarget(deviceId);
    if (!session) {
        return;
    }

    const normalized = (gridIndex + 1) / TOASTER_PAD_COUNT; // 0.0625 to 1.0

    const { padIndex: targetPad, target } = session;

    switch (target) {
        case 'velocity':
            triggerToasterPad(deviceId, targetPad, Math.round(normalized * 127));
            break;
        case 'tune':
            setPadParamImmediate({ deviceId, padIndex: targetPad, key: 'tune', value: -24 + normalized * 48 });
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        case 'decay':
            setPadParamImmediate({ deviceId, padIndex: targetPad, key: 'decay', value: normalized });
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        case 'filter': {
            const minHz = MIN_AUDIBLE_FREQ_HZ;
            const maxHz = MAX_AUDIBLE_FREQ_HZ;
            const freq = minHz * (maxHz / minHz) ** normalized;
            setPadParamImmediate({ deviceId, padIndex: targetPad, key: 'filterCutoff', value: freq });
            triggerToasterPad(deviceId, targetPad, 127);
            break;
        }
    }
}
