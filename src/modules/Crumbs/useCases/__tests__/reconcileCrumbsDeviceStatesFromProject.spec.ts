import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureDevice = { id: string; type: string; deviceState: unknown };
type FixtureTracks = { tracks: { id: string; kind: string; devices: FixtureDevice[] }[] };

const mocks = vi.hoisted(() => ({
    trackStore: { value: undefined as FixtureTracks | undefined },
    emitModeChanged: vi.fn(() => Promise.resolve()),
    nativeSetMode: vi.fn(() => Promise.resolve()),
    nativeLoadSample: vi.fn(),
    getWaveformPeaks: vi.fn(() => Promise.resolve([])),
    getDroppedWrites: vi.fn(() => Promise.resolve(0)),
    executeAppAction: vi.fn((_action: unknown) => Promise.resolve()),
}));

// Exhaustive over this spec's graph: the sweep reads `trackStore` and nothing
// else from this barrel.
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
// The engine doors the live routes push through, mocked so the assertions
// observe the push without a strip or a native session. The live routes
// themselves (`switchCrumbsMode`, `loadSampleFromPath`) stay real, so the
// session store carries exactly what a loaded session would hold. The strip
// push is the composition root's subscription, so the mode door is the
// emitted `crumbs.modeChanged` signal.
vi.mock('../../repositories/crumbsBridge/setCrumbsMode', () => ({ setCrumbsMode: mocks.nativeSetMode }));
vi.mock('../../repositories/crumbsBridge/loadSample', () => ({ loadSample: mocks.nativeLoadSample }));
vi.mock('../../repositories/crumbsBridge/getWaveformPeaks', () => ({ getWaveformPeaks: mocks.getWaveformPeaks }));
vi.mock('../../repositories/crumbsBridge/getCrumbsDroppedSampleWrites', () => ({
    getCrumbsDroppedSampleWrites: mocks.getDroppedWrites,
}));
// The persistence subscriber commits through this door; captured so the
// data-loss case can read exactly what a local edit mirrored into the document.
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));

import { setCrumbsEventBus } from '../../stores/crumbsEventBus';
import { crumbsStore, defaultCrumbsState, setMode, setTune } from '../../stores/crumbsStore';
import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';
import { loadSampleFromPath } from '../loadSample';
import { reconcileCrumbsDeviceStatesFromProject } from '../reconcileCrumbsDeviceStatesFromProject';

import type { SampleMeta } from '../../models/CrumbsTypes';

const DEVICE_ID = 'crumbs-peer-1';
const TRACK_ID = 'track-1';

const SAMPLE_A: SampleMeta = {
    sampleId: 1,
    sampleRate: 48000,
    channels: 2,
    frameCount: 1000,
    durationSecs: 0.02,
    detectedRoot: 60,
    detectedBpm: 120,
    category: 'loop',
    filePath: '/samples/a.wav',
    fileName: 'a.wav',
};

/**
 * What the session's own decode of `/samples/b.wav` produces. `sampleId` 42 is
 * *this* instance's counter value — deliberately different from the peer chunk's
 * 7 below, because an instance assigns its own ids and the store must carry the
 * id the local engine answers to.
 */
const LOCAL_DECODE_OF_B = {
    sampleId: 42,
    sampleRate: 48000,
    channels: 2,
    frameCount: 2000,
    durationSecs: 0.04,
    detectedRoot: 62,
    detectedBpm: 100,
    category: 'percussive',
    decodeWarningCount: 0,
    decodeWarnings: [],
};

function peerChunk(over: { mode?: string; sampleId?: number; filePath?: string } = {}): Record<string, unknown> {
    return {
        version: 1,
        data: {
            mode: over.mode ?? 'quick',
            activeSample: {
                ...SAMPLE_A,
                filePath: over.filePath ?? SAMPLE_A.filePath,
                sampleId: over.sampleId ?? SAMPLE_A.sampleId,
            },
        },
    };
}

function projectWith(...devices: FixtureDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: TRACK_ID, kind: 'midi', devices }] };
}

function crumbsDevice(deviceState: unknown): FixtureDevice {
    return { id: DEVICE_ID, type: 'builtin-crumbs', deviceState };
}

type SetDeviceStateAction = {
    type: 'setDeviceState';
    payload: { state: { data: { mode: string; activeSample: { filePath: string; sampleId?: number } | null } } };
};

function isSetDeviceStateAction(value: unknown): value is SetDeviceStateAction {
    return typeof value === 'object' && value !== null && 'type' in value && value.type === 'setDeviceState';
}

/** The sweep is synchronous; the sample route it triggers is async. */
function flushLoad(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A decode the case settles by hand, so a mid-window write has a window. */
function deferredDecode(): {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
} {
    let settleValue!: (value: unknown) => void;
    let settleError!: (error: Error) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
        settleValue = resolve;
        settleError = reject;
    });
    return { promise, resolve: settleValue, reject: settleError };
}

function setDeviceStateCommits(): SetDeviceStateAction[] {
    return mocks.executeAppAction.mock.calls.map((call) => call[0]).filter(isSetDeviceStateAction);
}

describe('reconcileCrumbsDeviceStatesFromProject', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.nativeLoadSample.mockResolvedValue(LOCAL_DECODE_OF_B);
        mocks.trackStore.value = undefined;
        setCrumbsEventBus({ emit: mocks.emitModeChanged });
        crumbsStore.set({ [DEVICE_ID]: { ...defaultCrumbsState, activeSample: SAMPLE_A } });
        // The persistence subscriber runs beside the sweep exactly as bootstrap
        // wires them: a reconciled sample is a store edit its committed map has
        // never seen, which is what the data-loss case reads back.
        stopPersistence = initCrumbsDeviceStatePersistence();
    });

    afterEach(() => {
        stopPersistence();
        crumbsStore.set({});
    });

    it('loads a peer-committed sample into the engine and the store', async () => {
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })));

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();

        expect(mocks.nativeLoadSample).toHaveBeenCalledWith(DEVICE_ID, '/samples/b.wav');
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/b.wav');
        // The store carries the id the local decode assigned, not the peer's
        // engine-local counter value the chunk carried.
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.sampleId).toBe(42);
    });

    it('switches a peer-committed mode through the store, the signal and the native instance', async () => {
        projectWith(crumbsDevice(peerChunk({ mode: 'slice', sampleId: 7, filePath: '/samples/b.wav' })));

        reconcileCrumbsDeviceStatesFromProject();

        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('slice');
        expect(mocks.emitModeChanged).toHaveBeenCalledWith('crumbs.modeChanged', {
            deviceId: DEVICE_ID,
            mode: 'slice',
        });
        expect(mocks.nativeSetMode).toHaveBeenCalledWith(DEVICE_ID, 'slice');
    });

    it('reconciles the owner type only', async () => {
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })), {
            id: 'toaster-1',
            type: 'toaster',
            deviceState: undefined,
        });

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();

        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/b.wav');
        expect(mocks.nativeLoadSample).toHaveBeenCalledTimes(1);
    });

    it('skips a device the session has not loaded', async () => {
        crumbsStore.set({});
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })));

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();

        expect(crumbsStore.value?.[DEVICE_ID]).toBeUndefined();
        expect(mocks.nativeLoadSample).not.toHaveBeenCalled();
    });

    // The guard that makes the sweep affordable and loop-free. `sampleId` is
    // deliberately absent from the comparison: it is an engine-local counter,
    // so two peers each holding their own id for the same file must read as
    // equal or every reconciliation would commit the local counter back and
    // the peers would chase each other forever.
    it('does not re-apply when the chunk matches mode and file even on a foreign sampleId', async () => {
        const storeBefore = crumbsStore.value?.[DEVICE_ID];
        projectWith(crumbsDevice(peerChunk({ sampleId: 999 })));

        reconcileCrumbsDeviceStatesFromProject();

        expect(crumbsStore.value?.[DEVICE_ID]).toBe(storeBefore);
        expect(mocks.nativeLoadSample).not.toHaveBeenCalled();
        expect(mocks.emitModeChanged).not.toHaveBeenCalled();
        expect(mocks.nativeSetMode).not.toHaveBeenCalled();
    });

    // #4764's data-loss shape: the peer loads a sample while the device is
    // loaded, then the user switches mode. The commit mirrors the chunk's whole
    // playback state, so it carries the peer's sample only if the
    // reconciliation applied it first — without that, this commit silently
    // reverts the peer's sample to the stale local one.
    it('carries the peer key in the next local edit’s commit', async () => {
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })));

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();
        setMode(DEVICE_ID, 'drum');

        const commit = mocks.executeAppAction.mock.calls.map((call) => call[0]).findLast(isSetDeviceStateAction);
        expect(commit).toBeDefined();
        expect(commit?.payload.state.data.mode).toBe('drum');
        expect(commit?.payload.state.data.activeSample?.filePath).toBe('/samples/b.wav');
    });

    // Finding 1's erasure shape: the paired load fails, and the hold's release
    // used to leave the baseline at the pre-pair key with the store still
    // holding the stale local sample — so the first later write of any kind
    // committed that stale sample over the peer's document reference. The
    // release must instead converge: restore the document's own reference into
    // the store's undecided sample leaf and commit it, so the later write
    // commits nothing and the peer's key survives.
    it('converges a failed pair at release, so a later unrelated write erases nothing', async () => {
        projectWith(crumbsDevice(peerChunk({ mode: 'slice', filePath: '/samples/b.wav', sampleId: 7 })));
        mocks.nativeLoadSample.mockRejectedValue(new Error('unreadable file'));
        // A pre-reconcile store edit seeds the persistence baseline at
        // {quick, a.wav}; without it the subscriber's first sight of the
        // reconcile's own mode apply would record without committing and the
        // case could not tell suppression from absence.
        setMode(DEVICE_ID, 'quick');

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();
        await flushLoad();
        // The reviewer's reproducing write: an unrelated knob after the failed
        // pair. It must not reopen the stale sample.
        setTune(DEVICE_ID, 3);
        await flushLoad();

        const commits = setDeviceStateCommits();
        expect(commits).toHaveLength(1);
        expect(commits[0]?.payload.state.data.mode).toBe('slice');
        // The commit carries the peer's sample leaf — the chunk's own reference,
        // peer-local sampleId included — never the stale local one.
        expect(commits[0]?.payload.state.data.activeSample?.filePath).toBe('/samples/b.wav');
        expect(commits[0]?.payload.state.data.activeSample?.sampleId).toBe(7);
        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('slice');
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/b.wav');
    });

    // The collapsed-pair leak: two paired reconciles for one device used to
    // collapse into one hold, so the first settle released the mirror while the
    // second decode was still in flight and a write in that window mirrored the
    // mid-pair state. The hold must last until the LAST settle, and the final
    // release converges the settled store.
    it('holds the mirror until the last settle of a collapsed pair, then converges', async () => {
        const firstDecode = deferredDecode();
        const secondDecode = deferredDecode();
        mocks.nativeLoadSample
            .mockImplementationOnce(() => firstDecode.promise)
            .mockImplementationOnce(() => secondDecode.promise);
        setMode(DEVICE_ID, 'quick');

        projectWith(crumbsDevice(peerChunk({ mode: 'slice', filePath: '/samples/b.wav', sampleId: 7 })));
        reconcileCrumbsDeviceStatesFromProject();
        projectWith(crumbsDevice(peerChunk({ mode: 'warp', filePath: '/samples/c.wav', sampleId: 8 })));
        reconcileCrumbsDeviceStatesFromProject();

        // The first pair settles while the second decode is still in flight.
        firstDecode.resolve(LOCAL_DECODE_OF_B);
        await flushLoad();
        await flushLoad();
        // A write inside the window must commit nothing mid-pair.
        setTune(DEVICE_ID, 3);
        await flushLoad();
        expect(setDeviceStateCommits()).toEqual([]);

        secondDecode.resolve({ ...LOCAL_DECODE_OF_B, sampleId: 43 });
        await flushLoad();
        await flushLoad();

        const commits = setDeviceStateCommits();
        expect(commits).toHaveLength(1);
        expect(commits[0]?.payload.state.data.mode).toBe('warp');
        expect(commits[0]?.payload.state.data.activeSample?.filePath).toBe('/samples/c.wav');
        expect(commits.some((commit) => commit.payload.state.data.activeSample?.filePath === '/samples/a.wav')).toBe(
            false
        );
    });

    // Finding 2's swallowed edit: a user drop that supersedes the reconcile
    // load lands in the store while the mirror is held, and the suppression
    // used to discard the pass silently — nothing replayed it at release, so
    // quitting persisted the peer's sample and lost the user's pick. The
    // release (or the pick's own settled write) must carry the pick.
    it('commits a user drop that supersedes the reconcile load instead of swallowing it', async () => {
        const peerDecode = deferredDecode();
        const userDecode = deferredDecode();
        mocks.nativeLoadSample
            .mockImplementationOnce(() => peerDecode.promise)
            .mockImplementationOnce(() => userDecode.promise);
        setMode(DEVICE_ID, 'quick');

        projectWith(crumbsDevice(peerChunk({ mode: 'slice', filePath: '/samples/b.wav', sampleId: 7 })));
        reconcileCrumbsDeviceStatesFromProject();
        // The user drops their own pick while the paired load is unsettled: a
        // newer load epoch that will win the store.
        const userPick = loadSampleFromPath(DEVICE_ID, '/samples/mine.wav');

        // The peer load settles superseded; the release converges the store as
        // it stands (the pick has not applied yet) instead of swallowing.
        peerDecode.resolve(LOCAL_DECODE_OF_B);
        await flushLoad();
        await flushLoad();
        expect(setDeviceStateCommits()).toHaveLength(1);

        // The pick settles: its own write must reach the document.
        userDecode.resolve({ ...LOCAL_DECODE_OF_B, sampleId: 43 });
        await userPick;
        await flushLoad();

        const commits = setDeviceStateCommits();
        expect(commits).toHaveLength(2);
        expect(commits[1]?.payload.state.data.mode).toBe('slice');
        expect(commits[1]?.payload.state.data.activeSample?.filePath).toBe('/samples/mine.wav');
        // No commit ever carried the stale local sample.
        expect(commits.some((commit) => commit.payload.state.data.activeSample?.filePath === '/samples/a.wav')).toBe(
            false
        );
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/mine.wav');
    });

    // The reviewer's withdrawal shape: while a paired decode is in flight the
    // peer reverts the document's sample to the very path the store already
    // holds. The re-sweep finds no change and starts nothing, so nothing
    // supersedes the in-flight decode — and its release used to commit the
    // decoded pick over the peer's newer write, silently undoing the revert
    // on both machines. The release must re-read the document and converge
    // to it: the peer's revert stands.
    it('converges a withdrawn pair to the document sample the peer reverted to', async () => {
        const peerDecode = deferredDecode();
        mocks.nativeLoadSample.mockImplementationOnce(() => peerDecode.promise);
        setMode(DEVICE_ID, 'quick');

        projectWith(crumbsDevice(peerChunk({ mode: 'slice', filePath: '/samples/b.wav', sampleId: 7 })));
        reconcileCrumbsDeviceStatesFromProject();

        // The peer reverts the sample mid-window; the wiring sweeps again and
        // finds the document already matching the store's leaf, so the
        // in-flight decode is never superseded.
        projectWith(crumbsDevice(peerChunk({ mode: 'slice', filePath: '/samples/a.wav', sampleId: 7 })));
        reconcileCrumbsDeviceStatesFromProject();
        expect(mocks.nativeLoadSample).toHaveBeenCalledTimes(1);

        peerDecode.resolve(LOCAL_DECODE_OF_B);
        await flushLoad();
        await flushLoad();

        const commits = setDeviceStateCommits();
        expect(commits).toHaveLength(1);
        expect(commits[0]?.payload.state.data.mode).toBe('slice');
        // The commit is the document's own truth, never the withdrawn pick.
        expect(commits[0]?.payload.state.data.activeSample?.filePath).toBe('/samples/a.wav');
        expect(commits.some((commit) => commit.payload.state.data.activeSample?.filePath === '/samples/b.wav')).toBe(
            false
        );
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/a.wav');
    });

    // The full-undo shape: the peer's undo reverts BOTH halves mid-window.
    // The re-sweep converges the mode back through the live route but starts
    // no load, so the in-flight decode still owns the epoch — and its release
    // used to commit the decoded pick over the reverted document. The release
    // must converge to the document's state: the settled store and the commit
    // carry what the peer restored, not what it withdrew.
    it('converges a fully undone pair to the document state the peer restored', async () => {
        const peerDecode = deferredDecode();
        mocks.nativeLoadSample.mockImplementationOnce(() => peerDecode.promise);
        setMode(DEVICE_ID, 'quick');

        projectWith(crumbsDevice(peerChunk({ mode: 'slice', filePath: '/samples/b.wav', sampleId: 7 })));
        reconcileCrumbsDeviceStatesFromProject();
        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('slice');

        // The peer's undo reverts mode and sample; the wiring sweeps again.
        projectWith(crumbsDevice(peerChunk({ sampleId: 7 })));
        reconcileCrumbsDeviceStatesFromProject();
        // The sweep converges the mode but starts no second decode.
        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('quick');
        expect(mocks.nativeLoadSample).toHaveBeenCalledTimes(1);

        peerDecode.resolve(LOCAL_DECODE_OF_B);
        await flushLoad();
        await flushLoad();

        const commits = setDeviceStateCommits();
        expect(commits).toHaveLength(1);
        expect(commits[0]?.payload.state.data.mode).toBe('quick');
        expect(commits[0]?.payload.state.data.activeSample?.filePath).toBe('/samples/a.wav');
        expect(commits.some((commit) => commit.payload.state.data.activeSample?.filePath === '/samples/b.wav')).toBe(
            false
        );
        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('quick');
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/a.wav');
    });

    it('commits the converged store at a paired settle and never the stale sample', async () => {
        projectWith(crumbsDevice(peerChunk({ mode: 'slice', filePath: '/samples/b.wav', sampleId: 7 })));
        setMode(DEVICE_ID, 'quick');

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();
        await flushLoad();

        // The suppression kept every mid-pair pass quiet, and the release is
        // the pair's convergence point: exactly one commit, carrying the
        // settled store. The stale local sample never reaches the document.
        const commits = setDeviceStateCommits();
        expect(commits).toHaveLength(1);
        expect(commits[0]?.payload.state.data.mode).toBe('slice');
        expect(commits[0]?.payload.state.data.activeSample?.filePath).toBe('/samples/b.wav');
        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('slice');
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/b.wav');

        // A later local edit still commits, carrying the settled sample.
        setMode(DEVICE_ID, 'drum');
        const commit = setDeviceStateCommits().at(-1);
        expect(commit).toBeDefined();
        expect(commit?.payload.state.data.mode).toBe('drum');
        expect(commit?.payload.state.data.activeSample?.filePath).toBe('/samples/b.wav');
    });
});
