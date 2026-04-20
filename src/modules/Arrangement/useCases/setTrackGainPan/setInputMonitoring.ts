import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../../repositories/track/updateTrack';
import { type InputMonitoring } from '../../stores/trackStore';

export function setInputMonitoring(trackId: string, mode: InputMonitoring): void {
    updateTrack(trackId, (t) => ({ ...t, inputMonitoring: mode }));

    if (mode === 'on') {
        startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
}
