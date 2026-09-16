/**
 * The renderer's one route for a live controller to a native-carried
 * instrument.
 *
 * Four things decide what happens to a pedal: that the batch carries the
 * controller and its raw 7-bit position field for field, that the message waits
 * behind everything already queued on the session, that a device this engine
 * does not hold a body for is not sent one — and that every call is remembered
 * whatever the other three decide, because a pedal nothing could be sent to is
 * still a pedal the player's foot is on.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type AudioGraphApplyResult, type AudioGraphBackend } from '../../../models/AudioGraphBackend';
import { readLatchedLiveMidiControls, type LatchedLiveMidiControl } from '../../../services/liveMidiControlLatch';
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

/** Records the engine as holding a body for the device the specs address. */
function holdsAddressedDevice(): void {
    nativeLiveGraphSession.nativeChainByStripId = new Map([['track-1', ['device-a']]]);
}

/** What the latch remembers for the device the specs address. */
function latchedForAddressedDevice(): readonly LatchedLiveMidiControl[] {
    return readLatchedLiveMidiControls().filter((control) => control.deviceId === 'device-a');
}

describe('sendNativeLiveMidiControl', () => {
    beforeEach(() => {
        holdsAddressedDevice();
    });

    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
        nativeLiveGraphSession.nativeChainByStripId = new Map();
        // Reset All Controllers is the message that discharges the latch, so it
        // is also how one spec's remembered pedals are kept out of the next.
        void sendNativeLiveMidiControl({
            trackId: 'track-1',
            deviceId: 'device-a',
            controller: 121,
            value: 0,
            channel: 0,
        });
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

    it('sends nothing and answers false with no session armed, and remembers the pedal anyway', async () => {
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
        // The foot is down whether or not anything could be told: the body the
        // next play builds is what this record exists to reach.
        expect(latchedForAddressedDevice()).toEqual([
            { trackId: 'track-1', deviceId: 'device-a', controller: 64, value: 127, channel: 0 },
        ]);
    });

    it('sends nothing to a device the session holds no body for, and remembers the pedal', async () => {
        const apply = armedSession();
        nativeLiveGraphSession.nativeChainByStripId = new Map([['track-1', ['device-b']]]);

        await expect(
            sendNativeLiveMidiControl({
                trackId: 'track-1',
                deviceId: 'device-a',
                controller: 66,
                value: 127,
                channel: 0,
            })
        ).resolves.toBe(false);

        expect(apply).not.toHaveBeenCalled();
        expect(latchedForAddressedDevice()).toEqual([
            { trackId: 'track-1', deviceId: 'device-a', controller: 66, value: 127, channel: 0 },
        ]);
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

    it('forgets every pedal on a device once Reset All Controllers is sent to it', async () => {
        armedSession();

        await sendNativeLiveMidiControl({
            trackId: 'track-1',
            deviceId: 'device-a',
            controller: 64,
            value: 127,
            channel: 0,
        });
        expect(latchedForAddressedDevice()).toHaveLength(1);

        await sendNativeLiveMidiControl({
            trackId: 'track-1',
            deviceId: 'device-a',
            controller: 121,
            value: 0,
            channel: 0,
        });

        // The message lifts the body's pedals, so remembering them past it
        // would press one back onto the next body built.
        expect(latchedForAddressedDevice()).toEqual([]);
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
