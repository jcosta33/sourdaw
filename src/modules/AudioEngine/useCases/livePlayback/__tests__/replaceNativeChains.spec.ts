/**
 * What a topology batch's strip reports do to the session's record of what the
 * engine's chains hold, and to the pedals the player is standing on (#3998).
 *
 * A topology batch builds every body again with its pedals up, so this is where
 * the remembered foot is spent — and only onto the devices the new chains
 * actually hold.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphStripReport,
} from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { replaceNativeChains } from '../replaceNativeChains';
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

/**
 * Presses a pedal with no chain recorded, which is what leaves it remembered
 * and unsent — the state a session start or a chain rebuild finds it in.
 */
async function pressRememberedDamper(deviceId: string): Promise<void> {
    await sendNativeLiveMidiControl({
        trackId: 'track-1',
        deviceId,
        controller: 64,
        value: 127,
        channel: 0,
    });
}

describe('replaceNativeChains', () => {
    afterEach(async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map();
        // Reset All Controllers is the message that discharges the record, so it
        // is also how one spec's remembered pedals are kept out of the next.
        for (const deviceId of ['gb-held', 'gb-gone']) {
            await sendNativeLiveMidiControl({
                trackId: 'track-1',
                deviceId,
                controller: 121,
                value: 0,
                channel: 0,
            });
        }
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('takes the reports as the whole record of what the chains hold', () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['comp']]]);

        replaceNativeChains([{ kind: 'track', id: 'audio-2', deviceIds: ['eq'] }]);

        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([['audio-2', ['eq']]]);
    });

    it('presses a remembered pedal onto a rebuilt body the new chain holds, and onto no other', async () => {
        const apply = armedSession();
        await pressRememberedDamper('gb-held');
        await pressRememberedDamper('gb-gone');
        expect(apply).not.toHaveBeenCalled();

        const reports: AudioGraphStripReport[] = [{ kind: 'track', id: 'track-1', deviceIds: ['gb-held'] }];
        replaceNativeChains(reports);
        await nativeLiveGraphSession.pending;

        // One send, for the one device the new chain holds. A replay running
        // before the record was written would find no chain at all and send
        // nothing, so the count decides the order as well as the addressee.
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'send-midi-control',
                    target: { trackId: 'track-1', deviceId: 'gb-held' },
                    controller: 64,
                    value: 127,
                    channel: 0,
                },
            ],
        });
    });

    it('sends nothing when no pedal is remembered', async () => {
        const apply = armedSession();

        replaceNativeChains([{ kind: 'track', id: 'track-1', deviceIds: ['gb-held'] }]);
        await nativeLiveGraphSession.pending;

        expect(apply).not.toHaveBeenCalled();
    });
});
