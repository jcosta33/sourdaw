/**
 * The renderer's one route for a live parameter write to a native-carried
 * built-in (#3893).
 *
 * Three things decide whether the write lands. The engine refuses a record past
 * its own ceiling and takes the whole batch with it, so the split has to happen
 * on this side. The split records are one gesture, so they have to travel in
 * one batch or an instrument holds half of each patch. And a caller with no
 * session open has to be told so rather than believing the engine took it.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    MAX_IMMEDIATE_DEVICE_PARAMETERS,
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
    type AudioGraphSetDeviceParametersCommand,
} from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { sendNativeDeviceParameters } from '../sendNativeDeviceParameters';

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

/** A patch of `count` distinct engine-shaped names, which is what a record carries. */
function patchOf(count: number): Record<string, number> {
    return Object.fromEntries(Array.from({ length: count }, (_value, index) => [`param_${index}`, index / 100]));
}

function parameterRecords(batch: AudioGraphCommandBatch | undefined): AudioGraphSetDeviceParametersCommand[] {
    return (batch?.commands ?? []).filter(
        (command): command is AudioGraphSetDeviceParametersCommand => command.kind === 'set-device-parameters'
    );
}

describe('sendNativeDeviceParameters', () => {
    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('sends one record carrying the stated values while a session is armed', async () => {
        const apply = armedSession();

        await expect(
            sendNativeDeviceParameters({ trackId: 'track-1', deviceId: 'device-a', values: { engine: 2, cutoff: 800 } })
        ).resolves.toBe(true);

        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'set-device-parameters',
                    target: { trackId: 'track-1', deviceId: 'device-a' },
                    values: { engine: 2, cutoff: 800 },
                },
            ],
        });
    });

    // A patch past the ceiling is the case the split exists for: sent whole it
    // is refused whole, and sent as two batches it is two sounds.
    it('splits a patch past the ceiling into records the engine takes, inside one batch', async () => {
        const apply = armedSession();

        await sendNativeDeviceParameters({
            trackId: 'track-1',
            deviceId: 'device-a',
            values: patchOf(MAX_IMMEDIATE_DEVICE_PARAMETERS + 2),
        });

        expect(apply).toHaveBeenCalledTimes(1);
        const batch = apply.mock.calls[0]?.[0];
        const records = parameterRecords(batch);
        expect(records.length).toBe(batch?.commands.length);
        expect(records.map((record) => Object.keys(record.values).length)).toEqual([
            MAX_IMMEDIATE_DEVICE_PARAMETERS,
            2,
        ]);
        expect(records.map((record) => record.target)).toEqual([
            { trackId: 'track-1', deviceId: 'device-a' },
            { trackId: 'track-1', deviceId: 'device-a' },
        ]);
    });

    // Every key has to survive the split, or the patch that lands is not the
    // patch the musician loaded.
    it('carries every value across the records it split the patch into', async () => {
        const apply = armedSession();
        const values = patchOf(MAX_IMMEDIATE_DEVICE_PARAMETERS + 2);

        await sendNativeDeviceParameters({ trackId: 'track-1', deviceId: 'device-a', values });

        const carried = Object.assign({}, ...parameterRecords(apply.mock.calls[0]?.[0]).map((record) => record.values));
        expect(carried).toEqual(values);
    });

    it('sends nothing and answers false with no session armed', async () => {
        const apply = armedSession();
        nativeLiveGraphSession.backend = null;

        await expect(
            sendNativeDeviceParameters({ trackId: 'track-1', deviceId: 'device-a', values: { engine: 2 } })
        ).resolves.toBe(false);

        expect(apply).not.toHaveBeenCalled();
    });

    // A projection that dropped every key it could not narrow leaves nothing to
    // write, and an empty record is a batch the engine is asked to apply for no
    // reason.
    it('sends nothing for a write carrying no values, and does not report a refusal', async () => {
        const apply = armedSession();

        await expect(
            sendNativeDeviceParameters({ trackId: 'track-1', deviceId: 'device-a', values: {} })
        ).resolves.toBe(true);

        expect(apply).not.toHaveBeenCalled();
    });
});
