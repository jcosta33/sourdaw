/**
 * The renderer's one route for a live controller to a native-carried
 * instrument.
 *
 * Three things decide whether a pedal reaches the instrument: that the batch
 * carries the controller and its raw 7-bit position field for field, that a
 * caller with no session open is told so rather than believing the engine took
 * it, and that the message waits behind everything already queued on the
 * session. A controller that overtook the batch splicing its own strip would
 * name a device the engine does not hold yet.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type AudioGraphApplyResult, type AudioGraphBackend } from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { sendNativeLiveMidiControl } from '../sendNativeLiveMidiControl';

const APPLIED: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    reports: [],
};

/** Arms the session on a backend whose every batch is recorded and accepted. */
function armedSession(): Mock<AudioGraphBackend['apply']> {
    const apply = vi.fn<AudioGraphBackend['apply']>(async () => APPLIED);
    nativeLiveGraphSession.backend = {
        backendId: 'stub-backend',
        apply,
        dispose: () => {},
    };
    return apply;
}

describe('sendNativeLiveMidiControl', () => {
    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('sends one batch carrying the stated controller while a session is armed', async () => {
        const apply = armedSession();

        await expect(
            sendNativeLiveMidiControl({
                trackId: 'track-1',
                deviceId: 'device-a',
                controller: 64,
                value: 96,
                channel: 5,
            })
        ).resolves.toBe(true);

        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'send-midi-control',
                    target: { trackId: 'track-1', deviceId: 'device-a' },
                    controller: 64,
                    value: 96,
                    channel: 5,
                },
            ],
        });
    });

    it('sends nothing and answers false with no session armed', async () => {
        const apply = armedSession();
        nativeLiveGraphSession.backend = null;

        await expect(
            sendNativeLiveMidiControl({
                trackId: 'track-1',
                deviceId: 'device-a',
                controller: 64,
                value: 127,
                channel: 0,
            })
        ).resolves.toBe(false);

        expect(apply).not.toHaveBeenCalled();
    });

    it('carries a pedal lift as a zero rather than defaulting the position', async () => {
        const apply = armedSession();

        await sendNativeLiveMidiControl({
            trackId: 'track-1',
            deviceId: 'device-a',
            controller: 66,
            value: 0,
            channel: 0,
        });

        expect(apply.mock.calls[0]?.[0]).toMatchObject({
            commands: [{ kind: 'send-midi-control', controller: 66, value: 0 }],
        });
    });

    it('waits behind what the session already has queued', async () => {
        const apply = armedSession();
        let releaseQueued = (): void => {};
        nativeLiveGraphSession.pending = new Promise<void>((resolve) => {
            releaseQueued = () => resolve();
        });

        const sent = sendNativeLiveMidiControl({
            trackId: 'track-1',
            deviceId: 'device-a',
            controller: 64,
            value: 127,
            channel: 0,
        });

        // One turn of the microtask queue: enough for an unqueued send to have
        // reached the backend already.
        await Promise.resolve();
        expect(apply).not.toHaveBeenCalled();

        releaseQueued();
        await expect(sent).resolves.toBe(true);
        expect(apply).toHaveBeenCalledTimes(1);
    });
});
