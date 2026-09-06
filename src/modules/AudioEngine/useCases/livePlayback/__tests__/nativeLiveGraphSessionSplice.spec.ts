/**
 * What happens when the engine takes a plugin instance mid-roll (#3575).
 *
 * The batch that attaches an instance is always mapped before the engine holds
 * it, so the strip it built has no body for that device. Parked, the next
 * play's topology batch binds it. Rolling, only this splice does — and it has
 * to be safe to fire for a device the mirror already placed, because both
 * triggers exist and neither knows about the other.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Device, type Track } from '#/modules/Arrangement/stores';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
} from '../../../models/AudioGraphBackend';
import { nativeLiveAutomationWriter, type LiveAutomationWriterPass } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSessionSplice } from '../nativeLiveGraphSessionSplice';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn<(message: string, level: string) => void>(),
    markExternalPluginEngineAttached: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: (message: string, level: string) => mocks.notifyUser(message, level),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return { ...actual, markExternalPluginEngineAttached: mocks.markExternalPluginEngineAttached };
});

const APPLIED: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    reports: [],
};

const apply = vi.fn<(batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult>>();

const backend: AudioGraphBackend = {
    backendId: 'spec-double',
    apply: (batch) => apply(batch),
    dispose: () => undefined,
};

function device(id: string, overrides?: Partial<Device>): Device {
    return { id, name: id, type: 'knead', bypassed: false, parameterValues: {}, ...overrides };
}

const PLUGIN_DEVICE = device('device-plugin', {
    name: 'Pro-Q',
    type: 'external-plugin',
    externalPluginId: 'clap:com.example.eq',
    externalInstanceId: 'inst-1',
});

function trackHolding(devices: readonly Device[]): Track {
    return { id: 'audio-1', name: 'Lead', devices: [...devices] } as unknown as Track;
}

/** A pass in flight, which is what makes a re-read something the writer can owe. */
function passInFlight(): LiveAutomationWriterPass {
    return {
        stripTracks: [],
        sampleRate: 48_000,
        programmeEndSeconds: 12,
        entrySeconds: 0,
        provenAfterBatch: null,
        looping: false,
        targets: [],
        loopTargets: null,
        lastLoopWraps: null,
        wrapFloorFrame: null,
        queueFullReported: false,
        saturatedGroups: new Set(),
    };
}

beforeEach(() => {
    apply.mockReset();
    apply.mockResolvedValue(APPLIED);
    mocks.notifyUser.mockReset();
    mocks.markExternalPluginEngineAttached.mockReset();
    nativeLiveGraphSession.backend = backend;
    nativeLiveGraphSession.rolling = true;
    nativeLiveGraphSession.lastDeferredChainNotice = null;
    nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['device-eq']]]);
    nativeLiveGraphSession.pending = Promise.resolve();
    nativeLiveAutomationWriter.pass = passInFlight();
    nativeLiveAutomationWriter.pendingRearm = null;
    trackStore.set({
        tracks: [trackHolding([device('device-eq'), PLUGIN_DEVICE])],
        selectedTrackId: null,
        ghostClips: [],
    });
});

afterEach(() => {
    trackStore.set(null);
    nativeLiveAutomationWriter.pass = null;
    nativeLiveAutomationWriter.pendingRearm = null;
});

describe('nativeLiveGraphSessionSplice', () => {
    // The index is counted against what the engine holds, so the plugin lands
    // behind the EQ that is actually in the chain rather than at whatever
    // position the project chain gives it.
    it('inserts the device at its place in the engine chain', async () => {
        const result = await nativeLiveGraphSessionSplice({ instanceId: 'inst-1' });

        expect(result).toEqual({ outcome: 'spliced' });
        expect(apply.mock.calls[0]?.[0].commands).toEqual([
            { kind: 'insert-device', trackId: 'audio-1', device: PLUGIN_DEVICE, index: 1 },
        ]);
    });

    // The splice puts a device on the wire exactly as the topology batch does,
    // so it owes the same translation: a chain sent in the ids a panel authors
    // is refused by name, and this batch is the one holding the transport open.
    // The device is addressed by instance here because that is the only handle
    // this route takes; what is under test is the record it carries.
    it('carries a built-in it splices in under the names the engine answers to', async () => {
        const builtin = device('device-synth', {
            type: 'fermenter',
            externalInstanceId: 'inst-2',
            parameterValues: { oscEngine: 2 },
        });
        trackStore.set({
            tracks: [trackHolding([device('device-eq'), builtin])],
            selectedTrackId: null,
            ghostClips: [],
        });

        await nativeLiveGraphSessionSplice({ instanceId: 'inst-2' });

        expect(apply.mock.calls[0]?.[0].commands).toEqual([
            {
                kind: 'insert-device',
                trackId: 'audio-1',
                device: { ...builtin, parameterValues: { engine: 2 } },
                index: 1,
            },
        ]);
    });

    /**
     * Idempotence, and it is not decoration: the mirror and this splice both
     * fire for a plugin added mid-roll, and the mapper refuses a batch naming a
     * device id already in a chain — which would take the whole batch down.
     */
    it('sends nothing when the engine already holds the device', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['device-eq', 'device-plugin']]]);

        const result = await nativeLiveGraphSessionSplice({ instanceId: 'inst-1' });

        expect(result).toEqual({ outcome: 'skipped', reason: 'already spliced' });
        expect(apply).not.toHaveBeenCalled();
    });

    // The next play's topology batch is built against the attach state and
    // binds the device by itself, so a parked session owes this nothing.
    it('sends nothing while the session is parked', async () => {
        nativeLiveGraphSession.rolling = false;

        const result = await nativeLiveGraphSessionSplice({ instanceId: 'inst-1' });

        expect(result).toEqual({ outcome: 'skipped', reason: 'parked' });
        expect(apply).not.toHaveBeenCalled();
    });

    it('sends nothing when no device in the project holds the instance', async () => {
        const result = await nativeLiveGraphSessionSplice({ instanceId: 'inst-unknown' });

        expect(result).toEqual({ outcome: 'skipped', reason: 'no device holds this instance' });
        expect(apply).not.toHaveBeenCalled();
    });

    it('sends nothing for a strip this session never built', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map();

        const result = await nativeLiveGraphSessionSplice({ instanceId: 'inst-1' });

        expect(result).toEqual({ outcome: 'skipped', reason: 'strip not built' });
        expect(apply).not.toHaveBeenCalled();
    });

    // A plugin the native strip cannot take is still loaded and still on
    // project truth; it plays on the next take, and the engineer hears why.
    it('says the plugin is deferred when the engine refuses the splice', async () => {
        apply.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'insert-device: chain at capacity',
        });

        const result = await nativeLiveGraphSessionSplice({ instanceId: 'inst-1' });

        expect(result).toEqual({ outcome: 'declined', reason: 'insert-device: chain at capacity' });
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            '"Pro-Q" on "Lead" takes effect on the next play: insert-device: chain at capacity',
            'warning'
        );
        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['device-eq']);
    });

    // The pass in flight was projected while the chain still had no body for
    // this plugin, so its parameters are in nobody's window (#3568). The
    // re-read is recorded rather than taken here because this splice answers
    // the automation pump's own attach report; the playhead feed takes it on
    // its next reading, ahead of the pump that sends the pass.
    it('states that the pass owes a re-read, dated by the batch that spliced the plugin in', async () => {
        apply.mockResolvedValue({ ...APPLIED, admittedBatch: 42 });

        await nativeLiveGraphSessionSplice({ instanceId: 'inst-1' });

        expect(nativeLiveAutomationWriter.pendingRearm).toEqual({ provenAfterBatch: 42 });
    });

    // A refused splice left the chain as it was, so the pass in flight is still
    // a true reading of it. Re-reading anyway would throw away every stamp the
    // engine already holds for the strips that did nothing wrong.
    it('leaves the pass alone when the engine refuses the splice', async () => {
        apply.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'insert-device: chain at capacity',
        });

        await nativeLiveGraphSessionSplice({ instanceId: 'inst-1' });

        expect(nativeLiveAutomationWriter.pendingRearm).toBeNull();
    });
});
