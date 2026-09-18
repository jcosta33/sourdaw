/**
 * The renderer's one route for a live bypass write to a native-carried
 * built-in (#3946).
 *
 * Two things decide whether the write lands. A session has to be open to queue
 * it on, and the command has to cross with the toggle's direction intact —
 * both directions are real writes, because taking a device out of bypass is as
 * audible as putting it in.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
    type AudioGraphSetDeviceBypassCommand,
} from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { sendNativeDeviceBypass } from '../sendNativeDeviceBypass';

const APPLIED: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    reports: [],
};

/** Arms the session on a backend whose every batch is recorded and accepted. */
function armedSession(): Mock<AudioGraphBackend['apply']> {
    const apply = vi.fn<AudioGraphBackend['apply']>(async () => APPLIED);
    nativeLiveGraphSession.backend = { backendId: 'stub-backend', apply, dispose: () => {} };
    return apply;
}

function bypassCommands(batch: AudioGraphCommandBatch | undefined): AudioGraphSetDeviceBypassCommand[] {
    return (batch?.commands ?? []).filter(
        (command): command is AudioGraphSetDeviceBypassCommand => command.kind === 'set-device-bypass'
    );
}

describe('sendNativeDeviceBypass', () => {
    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('sends one command carrying the stated direction while a session is armed', async () => {
        const apply = armedSession();

        await expect(
            sendNativeDeviceBypass({ trackId: 'track-1', deviceId: 'device-a', bypassed: true })
        ).resolves.toBe(true);

        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'set-device-bypass',
                    target: { trackId: 'track-1', deviceId: 'device-a' },
                    bypassed: true,
                },
            ],
        });
    });

    // Releasing a bypass is its own write, not the absence of one: a
    // serializer that dropped a `false` would strand the device silenced past
    // the toggle that released it.
    it('carries a release as its own command, not as absence', async () => {
        const apply = armedSession();

        await sendNativeDeviceBypass({ trackId: 'track-1', deviceId: 'device-a', bypassed: false });

        expect(bypassCommands(apply.mock.calls[0]?.[0])).toEqual([
            {
                kind: 'set-device-bypass',
                target: { trackId: 'track-1', deviceId: 'device-a' },
                bypassed: false,
            },
        ]);
    });

    it('sends nothing and answers false with no session armed', async () => {
        const apply = armedSession();
        nativeLiveGraphSession.backend = null;

        await expect(
            sendNativeDeviceBypass({ trackId: 'track-1', deviceId: 'device-a', bypassed: true })
        ).resolves.toBe(false);

        expect(apply).not.toHaveBeenCalled();
    });
});
