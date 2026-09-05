/**
 * What a device-chain change does to a rolling native session (#3575).
 *
 * The double is the session's own backend handle, because that is the seam this
 * use case actually addresses: it reads the session state and sends one batch.
 * Standing up the transport probe and the topology producer would prove the
 * start sequence again, which has its own file.
 *
 * The indices are the point of most of these cases. A device the mapper omitted
 * is absent from the chain the engine reports, so every index counted against
 * the project chain is wrong the moment one device degrades — and wrong by a
 * slot means the compressor lands ahead of the EQ rather than behind it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommand,
    type AudioGraphCommandBatch,
} from '../../../models/AudioGraphBackend';
import { stoppedEngineTransportPosition } from '../../../models/EngineTransportPosition';
import { mirrorDeviceChainDelta } from '../mirrorDeviceChainDelta';
import { nativeEnginePlayheadFeed } from '../nativeEnginePlayheadFeedState';
import { nativeLiveAutomationWriter, type LiveAutomationWriterPass } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { rearmNativeLiveAutomationWriterInPlace } from '../rearmNativeLiveAutomationWriterInPlace';
import { recordNativeChainReleases } from '../recordNativeChainReleases';

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
vi.mock('../rearmNativeLiveAutomationWriterInPlace', () => ({
    rearmNativeLiveAutomationWriterInPlace: vi.fn(),
}));

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

function track(devices: readonly Device[]): Track {
    return { id: 'audio-1', name: 'Lead', devices: [...devices] } as unknown as Track;
}

/** The commands the one batch this mirror sent carried. */
function sentCommands(): readonly AudioGraphCommand[] {
    expect(apply).toHaveBeenCalledTimes(1);
    return apply.mock.calls[0]?.[0].commands ?? [];
}

/**
 * A pass in flight that writes one parameter of `deviceId`, which is what makes
 * removing that device something the pass has to be told about.
 */
function passWritesParameterOf(deviceId: string): void {
    nativeLiveAutomationWriter.pass = {
        targets: [
            {
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId, parameterId: '7' },
                writes: [],
                cursor: 0,
                queued: [],
            },
        ],
    } as unknown as LiveAutomationWriterPass;
}

beforeEach(() => {
    apply.mockReset();
    apply.mockResolvedValue(APPLIED);
    mocks.notifyUser.mockReset();
    mocks.markExternalPluginEngineAttached.mockReset();
    nativeLiveGraphSession.backend = backend;
    nativeLiveGraphSession.rolling = true;
    nativeLiveGraphSession.lastDeferredChainNotice = null;
    nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['eq', 'comp']]]);
    nativeLiveGraphSession.pending = Promise.resolve();
    vi.mocked(rearmNativeLiveAutomationWriterInPlace).mockClear();
    nativeEnginePlayheadFeed.reading = null;
    nativeLiveAutomationWriter.pass = null;
});

describe('mirrorDeviceChainDelta', () => {
    it('sends nothing when no native session is open', async () => {
        nativeLiveGraphSession.backend = null;

        const result = await mirrorDeviceChainDelta({
            before: track([device('eq')]),
            after: track([device('eq'), device('comp')]),
        });

        expect(result).toEqual({ outcome: 'skipped', reason: 'no session' });
        expect(apply).not.toHaveBeenCalled();
    });

    // The next play sends the whole topology built from project truth as it
    // stands then, so a parked session owes this change nothing.
    it('sends nothing while the session is parked', async () => {
        nativeLiveGraphSession.rolling = false;

        const result = await mirrorDeviceChainDelta({
            before: track([device('eq')]),
            after: track([device('eq'), device('comp')]),
        });

        expect(result).toEqual({ outcome: 'skipped', reason: 'parked' });
        expect(apply).not.toHaveBeenCalled();
    });

    // A track added since the topology went out has no strip to edit, and
    // nothing here creates one — `insert-device` on an unknown strip refuses
    // the batch.
    it('sends nothing for a strip this session never built', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map();

        const result = await mirrorDeviceChainDelta({
            before: track([device('eq')]),
            after: track([device('eq'), device('comp')]),
        });

        expect(result).toEqual({ outcome: 'skipped', reason: 'strip not built' });
        expect(apply).not.toHaveBeenCalled();
    });

    // The removed device was degraded when the strip was built, so the engine
    // never held it and there is nothing to unlink.
    it('sends nothing when the change touches only devices the engine never held', async () => {
        const result = await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp'), device('degraded')]),
            after: track([device('eq'), device('comp')]),
        });

        expect(result).toEqual({ outcome: 'skipped', reason: 'nothing to mirror' });
        expect(apply).not.toHaveBeenCalled();
    });

    it('records the reports of the batch the engine applied', async () => {
        apply.mockResolvedValue({
            ...APPLIED,
            reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['eq', 'comp', 'knead'] }],
        });

        const result = await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp')]),
            after: track([device('eq'), device('comp'), device('knead')]),
        });

        expect(result).toEqual({ outcome: 'mirrored' });
        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['eq', 'comp', 'knead']);
    });

    /**
     * The whole point of counting the index against the engine's chain. The
     * project chain is [eq, degraded, comp, knead] and the engine holds
     * [eq, comp]: read off the project, the new device would go in at 3 and
     * clamp to the end by luck — but the same arithmetic one device earlier
     * puts a device on the wrong side of its neighbour, so the index is the
     * count of devices ahead of it the engine actually has.
     */
    it('counts an insert index against the engine chain, not the project chain', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['eq', 'comp']]]);

        await mirrorDeviceChainDelta({
            before: track([device('eq'), device('degraded'), device('comp')]),
            after: track([device('eq'), device('degraded'), device('knead'), device('comp')]),
        });

        expect(sentCommands()).toEqual([
            { kind: 'insert-device', trackId: 'audio-1', device: device('knead'), index: 1 },
        ]);
    });

    // Removals land first and the inserts are counted against what is left, so
    // an insert cannot be placed against a slot the same batch is about to
    // vacate.
    it('counts insert indices against the chain the removals in the same batch leave behind', async () => {
        await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp')]),
            after: track([device('comp'), device('knead')]),
        });

        expect(sentCommands()).toEqual([
            { kind: 'remove-device', trackId: 'audio-1', deviceId: 'eq' },
            { kind: 'insert-device', trackId: 'audio-1', device: device('knead'), index: 1 },
        ]);
    });

    /**
     * There is no command that moves a device the engine already holds, so a
     * reorder is the chain taken down and built back in one batch. The batch
     * applies at a single block boundary, so the strip is never observed
     * holding half of each order.
     */
    it('rebuilds the whole chain in one batch when the devices only changed order', async () => {
        await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp')]),
            after: track([device('comp'), device('eq')]),
        });

        expect(sentCommands()).toEqual([
            { kind: 'remove-device', trackId: 'audio-1', deviceId: 'eq' },
            { kind: 'remove-device', trackId: 'audio-1', deviceId: 'comp' },
            { kind: 'insert-device', trackId: 'audio-1', device: device('comp'), index: 0 },
            { kind: 'insert-device', trackId: 'audio-1', device: device('eq'), index: 1 },
        ]);
    });

    /**
     * The device the engineer added is on project truth and audible through Web
     * Audio; the native strip cannot host it until the carrier law reads the
     * new chain, which is the next play. Left unsaid this is a device that does
     * nothing with no account of why.
     */
    it('leaves the record alone and says the change is deferred when the engine refuses', async () => {
        apply.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'insert-device: no native realisation for "dutch-oven"',
        });

        const result = await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp')]),
            after: track([device('eq'), device('comp'), device('oven', { name: 'Dutch Oven' })]),
        });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'insert-device: no native realisation for "dutch-oven"',
        });
        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['eq', 'comp']);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            '"Dutch Oven" on "Lead" takes effect on the next play: insert-device: no native realisation for "dutch-oven"',
            'warning'
        );
    });

    // The same refusal twice is the same news twice.
    it('says a repeated deferral once', async () => {
        apply.mockResolvedValue({ acceptance: 'rejected', application: 'not-applied', reason: 'chain at capacity' });
        const change = {
            before: track([device('eq'), device('comp')]),
            after: track([device('eq'), device('comp'), device('oven', { name: 'Dutch Oven' })]),
        };

        await mirrorDeviceChainDelta(change);
        await mirrorDeviceChainDelta(change);

        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    /**
     * The caller is a project mutation whose Web Audio delta has already
     * landed. An unreadable answer from the bridge is the mirror's problem, not
     * the mutation's, so it reaches the caller as a rejection it chose to
     * observe rather than as an unwind it did not.
     */
    it('rejects rather than resolving when the bridge answer cannot be read', async () => {
        apply.mockRejectedValue(new Error('unreadable native answer'));

        await expect(
            mirrorDeviceChainDelta({
                before: track([device('eq'), device('comp')]),
                after: track([device('eq'), device('comp'), device('knead')]),
            })
        ).rejects.toThrow('unreadable native answer');
        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['eq', 'comp']);
    });

    /**
     * A plugin dropped onto a rolling track is the case (#3568). The pass in
     * flight was projected before the chain held it, so it describes no writes
     * for its parameters and the lane would do nothing until the next locate.
     * The re-read runs from where the engine stands rather than from the pass's
     * own entry, or the window it produces is behind the playhead.
     *
     * A built-in insert must not re-read: the engine stamps hosted plugin
     * parameters and nothing else's, so the new pass would describe the same
     * writes as the old one and cost a whole lookahead of admitted stamps.
     */
    it('re-reads the pass from the engine position when a hosted plugin joins the chain', async () => {
        nativeEnginePlayheadFeed.reading = {
            ...stoppedEngineTransportPosition,
            running: true,
            playing: true,
            positionSeconds: 4.5,
        };
        apply.mockResolvedValue({ ...APPLIED, admittedBatch: 12 });
        const plugin = device('plug', { type: 'external-plugin', externalPluginId: 'clap:com.example.eq' });

        await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp')]),
            after: track([device('eq'), device('comp'), plugin]),
        });

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).toHaveBeenCalledWith({
            provenAfterBatch: 12,
            positionSeconds: 4.5,
        });
    });

    it('leaves the pass in flight alone when the device that joined is a built-in', async () => {
        await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp')]),
            after: track([device('eq'), device('comp'), device('knead')]),
        });

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).not.toHaveBeenCalled();
    });

    /**
     * Removing a plugin the pass still writes is the other half (#3568). The
     * pass keeps naming it, `graph.rs` refuses the whole `write-device-parameter`
     * batch as `unknown device`, and a whole-batch refusal advances no cursor —
     * so every strip's automation, not only this plugin's, freezes until a
     * locate re-arms.
     */
    it('re-reads the pass when the chain loses a device that pass still writes', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['eq', 'plug']]]);
        passWritesParameterOf('plug');
        nativeEnginePlayheadFeed.reading = {
            ...stoppedEngineTransportPosition,
            running: true,
            playing: true,
            positionSeconds: 2,
        };
        apply.mockResolvedValue({ ...APPLIED, admittedBatch: 21 });

        await mirrorDeviceChainDelta({
            before: track([device('eq'), device('plug')]),
            after: track([device('eq')]),
        });

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).toHaveBeenCalledWith({
            provenAfterBatch: 21,
            positionSeconds: 2,
        });
    });

    // A device no lane drives is a device no pump can name, so removing it
    // cannot poison a batch — and re-arming for it would spend a whole
    // lookahead of admitted stamps on a projection that says the same thing.
    it('leaves the pass in flight alone when the device that left was one it never wrote', async () => {
        passWritesParameterOf('some-other-device');

        await mirrorDeviceChainDelta({
            before: track([device('eq'), device('comp')]),
            after: track([device('eq')]),
        });

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).not.toHaveBeenCalled();
    });

    /**
     * An unload changes native strip state with no batch of its own, so
     * nothing here observes it directly — the session's record is exactly
     * what `recordNativeChainReleases` left it with. `proq` still sits in the
     * project chain (its device box was never removed; only its native
     * instance was retired elsewhere), so the index below is counted against
     * the chain the engine actually holds, not against the project order that
     * still names a device the engine no longer does (#3793).
     */
    it('lands an insert after a device an unload released before the next held device', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['comp', 'proq', 'limiter']]]);
        recordNativeChainReleases([{ id: 'audio-1', deviceIds: ['comp', 'limiter'] }]);

        await mirrorDeviceChainDelta({
            before: track([device('comp'), device('proq'), device('limiter')]),
            after: track([device('comp'), device('proq'), device('knead'), device('limiter')]),
        });

        expect(sentCommands()).toEqual([
            { kind: 'insert-device', trackId: 'audio-1', device: device('knead'), index: 1 },
        ]);
    });
});
