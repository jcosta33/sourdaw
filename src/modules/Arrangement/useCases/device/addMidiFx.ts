import { logger } from '#/infra/logger/appLogger';
import { addMidiFxToStrip } from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { updateTrack } from '../updateTrack';

export function addMidiFx(trackId: string, fxType: 'arp' | 'velocity' | 'probability', name?: string): void {
    const track = getTrackById(trackId);
    if (!track || !getTrackEligibility(track.kind).acceptsMidiFxAdd) {
        return;
    }
    const fxId = `midi-fx-${crypto.randomUUID().slice(0, 8)}`;

    updateTrack(trackId, (track) => {
        const nextMidiFx = [...(track.midiFx || [])];
        nextMidiFx.push({
            id: fxId,
            name: name ?? fxType.toUpperCase(),
            type: fxType,
            bypassed: false,
            parameterValues: {},
        });
        return { ...track, midiFx: nextMidiFx };
    });

    try {
        addMidiFxToStrip(trackId, fxId, fxType);
    } catch (error) {
        logger.warn(`Failed to add MIDI FX to engine: ${error}`);
    }
}
