import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { hasLiveNativeGraphSession } from '../livePlayback/hasLiveNativeGraphSession';
import { nativeLiveGraphSession } from '../livePlayback/nativeLiveGraphSessionState';

import { audioDeviceStore } from './helpers';

type AudioContextWithSinkId = AudioContext & {
    setSinkId?: (deviceId: string) => Promise<void>;
};

/**
 * Whether an audible native carrier is sounding strips right now.
 *
 * The native engine owns its output device itself: it opens the OS default
 * (`crates/daw-engine/src/device/cpal_backend.rs`) and offers no command to
 * move it, so while it is the audible carrier there is no route from this use
 * case to the device its mix is leaving through. A parked or shadowed session
 * sounds nothing — Web Audio is then the only audible carrier — so those
 * leave the selection free (#3643).
 */
function isAudibleNativeCarrierActive(): boolean {
    return hasLiveNativeGraphSession() && nativeLiveGraphSession.audibleCarrier;
}

let outputDeviceQueue: Promise<void> = Promise.resolve();

export const setOutputDevice = inject({ logger, notifyUser })(
    ({ logger, notifyUser }) =>
        function setOutputDevice(deviceId: string): Promise<void> {
            const request = outputDeviceQueue.then(async () => {
                // #3643 — a selection made while the native engine is the
                // audible carrier cannot be delivered to it, and applying it
                // to the browser sink alone would split one visible selection
                // across two devices. Refuse the change outright: the store
                // keeps naming the output actually in force, and the musician
                // is told why rather than left believing the whole mix moved.
                // Stopping playback releases the strips back to Web Audio,
                // after which the same selection applies.
                if (isAudibleNativeCarrierActive()) {
                    logger.warn(
                        'Refused an output device change while the audible native engine holds the system default output'
                    );
                    notifyUser(
                        'Output device cannot change while the native audio engine is audible — it plays through the ' +
                            'system default output. Stop playback to switch outputs.',
                        'warning'
                    );
                    return;
                }

                const context = audioEngine.context as AudioContextWithSinkId;
                if (typeof context.setSinkId !== 'function') {
                    logger.warn('Failed to set output device: setSinkId is unavailable');
                    notifyUser('Unable to set output device.', 'error');
                    return;
                }

                try {
                    await context.setSinkId(deviceId);
                } catch (error) {
                    logger.warn(`Failed to set output device: ${error}`);
                    notifyUser('Unable to set output device.', 'error');
                    return;
                }

                const current = audioDeviceStore.value;
                audioDeviceStore.set({ ...current!, selectedOutputId: deviceId });
            });

            outputDeviceQueue = request.catch(() => undefined);
            return request;
        }
);
