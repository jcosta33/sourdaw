/**
 * Use case for bus and send management.
 *
 * Handles bus strip creation, gain, and send routing between tracks and buses.
 */
import {
    ensureBusStrip as ensureBusStripEngine,
    setBusGain as setBusGainEngine,
    setSend as setSendEngine,
} from '#/modules/AudioEngine/useCases/engineAccess';

export function ensureBusStrip(busId: string): void {
    ensureBusStripEngine(busId);
}

export function setBusGain(busId: string, gain: number): void {
    setBusGainEngine(busId, gain);
}

export function setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
    setSendEngine(sourceTrackId, busId, level, preFader);
}
