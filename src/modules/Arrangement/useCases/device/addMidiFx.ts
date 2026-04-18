import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '../../stores';
import { updateTrack } from '../updateTrack';
import { addMidiFxToStrip } from '#/modules/AudioEngine';

export function addMidiFx(
    trackId: string,
    fxType: 'arp' | 'velocity' | 'probability',
    name?: string
): void {
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
