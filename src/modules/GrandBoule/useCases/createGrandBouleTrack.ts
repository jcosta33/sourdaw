/**
 * Create a Grand Boule piano track.
 *
 * Creates a MIDI track with the Grand Boule device attached and wires it
 * into the audio engine strip.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { appendTrack, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { addDeviceToStrip, getTrackStrip } from '#/modules/AudioEngine/useCases';

import { GrandBouleEventBus } from './grandBouleEventBus';

export const createGrandBouleTrack = inject({ eventBus: GrandBouleEventBus })(
    ({ eventBus }) =>
        function createGrandBouleTrack(): string | null {
            if (trackStore.value === null) {
                return null;
            }

            const track = createTrack({ name: 'Grand Boule', kind: 'midi' });
            const deviceId = `grand-boule-${crypto.randomUUID().slice(0, 8)}`;
            track.devices = [
                {
                    id: deviceId,
                    name: 'Grand Boule',
                    type: 'grand-boule',
                    bypassed: false,
                    parameterValues: {},
                },
            ];

            appendTrack(track);

            addDeviceToStrip(track.id, deviceId, 'grand-boule');

            // `addDeviceToStrip` is fire-and-forget (it swallows the
            // fallback-mode and missing-strip cases), so confirm the device
            // actually landed on the strip before announcing a fully-wired
            // track. A failed wiring must not emit `track.added`.
            const wired = getTrackStrip(track.id)?.deviceNodes.some((node) => node.deviceId === deviceId) ?? false;
            if (!wired) {
                logger.warn(
                    `createGrandBouleTrack: device "${deviceId}" was not wired into strip for track "${track.id}" — skipping track.added`
                );
                return track.id;
            }

            void eventBus.emit('track.added', { trackId: track.id, name: track.name, kind: track.kind });

            return track.id;
        }
);
