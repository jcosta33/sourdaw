/**
 * The renderer's one route for a live note to a native-carried instrument.
 *
 * Two things decide whether a note sounds: that the batch carries the note the
 * caller stated, field for field, and that a caller with no session open is
 * told so rather than believing the engine took it. A `sendNativeLiveMidiNote`
 * that answered `true` regardless would leave a Web Audio fallback silent while
 * nothing else voiced the note.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type AudioGraphApplyResult, type AudioGraphBackend } from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { sendNativeLiveMidiNote } from '../sendNativeLiveMidiNote';

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

describe('sendNativeLiveMidiNote', () => {
    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('sends one batch carrying the stated note while a session is armed', async () => {
        const apply = armedSession();

        await expect(
            sendNativeLiveMidiNote({
                trackId: 'track-1',
                deviceId: 'device-a',
                note: 60,
                velocity: 100,
                channel: 5,
                isNoteOn: true,
            })
        ).resolves.toBe(true);

        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'send-midi-note',
                    target: { trackId: 'track-1', deviceId: 'device-a' },
                    note: 60,
                    velocity: 100,
                    channel: 5,
                    isNoteOn: true,
                },
            ],
        });
    });

    it('sends nothing and answers false with no session armed', async () => {
        const apply = armedSession();
        nativeLiveGraphSession.backend = null;

        await expect(
            sendNativeLiveMidiNote({
                trackId: 'track-1',
                deviceId: 'device-a',
                note: 60,
                velocity: 100,
                channel: 0,
                isNoteOn: true,
            })
        ).resolves.toBe(false);

        expect(apply).not.toHaveBeenCalled();
    });

    it('carries a release as a release rather than defaulting the direction', async () => {
        const apply = armedSession();

        await sendNativeLiveMidiNote({
            trackId: 'track-1',
            deviceId: 'device-a',
            note: 60,
            velocity: 0,
            channel: 0,
            isNoteOn: false,
        });

        expect(apply.mock.calls[0]?.[0]).toMatchObject({
            commands: [{ kind: 'send-midi-note', isNoteOn: false, velocity: 0 }],
        });
    });
});
