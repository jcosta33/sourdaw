/**
 * Use case for bus and send management.
 *
 * Handles bus strip creation, gain, and send routing between tracks and buses.
 */
import { inject } from '#/infra/di/inject';
import {
    ensureBusStrip as ensureBusStripEngine,
    setBusGain as setBusGainEngine,
    setSend as setSendEngine,
} from '#/modules/AudioEngine/useCases';

const busStripDependencies = { ensureBusStripEngine } as const;

export const ensureBusStrip = inject(busStripDependencies)(
    ({ ensureBusStripEngine }) =>
        function ensureBusStrip(busId: string): void {
            ensureBusStripEngine(busId);
        }
);

const busGainDependencies = { setBusGainEngine } as const;

export const setBusGain = inject(busGainDependencies)(
    ({ setBusGainEngine }) =>
        function setBusGain(busId: string, gain: number): void {
            setBusGainEngine(busId, gain);
        }
);

const sendDependencies = { setSendEngine } as const;

export const setSend = inject(sendDependencies)(
    ({ setSendEngine }) =>
        function setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
            setSendEngine(sourceTrackId, busId, level, preFader);
        }
);
