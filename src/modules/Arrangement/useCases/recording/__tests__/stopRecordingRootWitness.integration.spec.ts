import { clone as cloneAutomergeDoc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { activeRecordingRef, takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    DOC_PREFIX_ROOT,
    captureProjectRootIdentity,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { getTrackState } from '../../../repositories/track/getTrackState';
import { startRecording } from '../startRecording';
import { stopRecording } from '../stopRecording';

/**
 * The Stop finaliser's root-ownership witness (#5517). A take belongs to the
 * root it was opened on: when a branch move replaced the root mid-recording,
 * the finaliser refuses to close the take, commit it, or discard under the
 * successor, the same refusal shape the capture terminal's guards settled on
 * (#5289). The real CRDT root, the real root-identity epoch, the real staging
 * and finaliser drive every case; only the recorder's commit dispatch, the
 * transport store, and the notice are stand-ins.
 */

const notifyUser = vi.hoisted(() => vi.fn());

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const state: { value: { playheadPosition: number; isPlaying: boolean; isRecording: boolean } | null } = {
        value: { playheadPosition: 4, isPlaying: false, isRecording: true },
    };
    // The rest of the barrel stays real: the staging chain reads other
    // members (playheadPositionRef among them) that this spec does not steer.
    return {
        ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
        transportStore: {
            get value() {
                return state.value;
            },
            set(next: typeof state.value) {
                state.value = next;
            },
        },
    };
});

const commitRecording = vi.hoisted(() =>
    vi.fn<(clip: unknown, capture?: unknown, options?: unknown) => Promise<void>>()
);
vi.mock('../commitRecording', () => ({ commitRecording }));

const TRACK_ID = 'track-recording';

/** Field-identical replica of Arrangement's TrackDummy fixture, as other
 *  modules' specs keep their own copy rather than deep-importing a foreign
 *  `__tests__` helper. */
function recordingTrack(kind: 'audio' | 'midi'): Track {
    return {
        id: TRACK_ID,
        name: kind === 'audio' ? 'Audio' : 'Midi',
        kind,
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function stagedClipEndBeat(): number | undefined {
    return getTrackState()?.tracks.find((track) => track.id === TRACK_ID)?.clips[0]?.endBeat;
}

function stagedClipCount(): number {
    return getTrackState()?.tracks.find((track) => track.id === TRACK_ID)?.clips.length ?? 0;
}

/** Model the identity-moving project replacement the witness polices — a
 *  branch fork or switch installing a different document in the root slot —
 *  through the barrel's seam for exactly that (see replaceCrdtDoc). */
function installRootReplacement(): void {
    const root = getCrdtDoc(DOC_PREFIX_ROOT);
    if (!root) {
        throw new Error('expected the root document to be installed');
    }
    replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
}

describe('stopRecording publishes only under its captured root (issue #5517)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('stop recording root witness');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        // The real branch-state authority sequences every durable write on a
        // Web Lock, and jsdom ships no Web Locks API.
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        trackStore.set({ tracks: [recordingTrack('midi')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        commitRecording.mockImplementation(() => Promise.resolve());
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        try {
            flushAutomergeStorageWrites();
        } catch {
            // A staged optimistic write crossing the replacement is refused by
            // the adapter on flush — its own protection, not this spec's
            // subject. The port reset below discards the storage.
        }
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('stages the take under a captured root identity', () => {
        const clips = startRecording();

        expect(clips).toHaveLength(1);
        expect(activeRecordingRef.capturedRootIdentity).toBe(captureProjectRootIdentity());
        expect(stagedClipCount()).toBe(1);
    });

    it('refuses to close or commit the take when the root was replaced mid-recording', async () => {
        startRecording();
        const stagedEndBeat = stagedClipEndBeat();
        installRootReplacement();

        await stopRecording();

        // Nothing was written into the successor: the staged clip keeps its
        // staged end, no commit dispatched, and the musician is told the take
        // stayed on its branch.
        expect(stagedClipEndBeat()).toBe(stagedEndBeat);
        expect(commitRecording).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(
            'Recording stopped — the project switched branches while recording, so it was not kept.',
            'warning'
        );
        expect(activeRecordingRef.current).toEqual([]);
        expect(activeRecordingRef.capturedRootIdentity).toBeNull();
    });

    it('closes and commits the take on the same root', async () => {
        startRecording();
        const [clip] = getTrackState()?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? [];
        if (!clip) {
            throw new Error('expected a staged recording clip');
        }

        await stopRecording();

        expect(commitRecording).toHaveBeenCalledTimes(1);
        expect(commitRecording).toHaveBeenCalledWith(
            expect.objectContaining({ id: clip.id }),
            undefined,
            expect.objectContaining({ shouldExecute: expect.any(Function) })
        );
        expect(stagedClipEndBeat()).toBeGreaterThanOrEqual(clip.startBeat + 1);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('keeps the take on its owning root when the root moves while the commit is in flight', async () => {
        startRecording();
        let resolveCommit: () => void = () => undefined;
        commitRecording.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveCommit = resolve;
                })
        );
        const stopping = stopRecording();
        expect(commitRecording).toHaveBeenCalledTimes(1);

        // The root moves while the commit dispatch is parked; the resume
        // refusal keeps the finalized take on its owning root and reports the
        // branch move instead of discarding under the successor.
        installRootReplacement();
        resolveCommit();
        await stopping;

        expect(notifyUser).toHaveBeenCalledWith(
            'Recording stopped — the project switched branches while the take was landing, so it was not kept.',
            'warning'
        );
        // The finalized clip is still present: no discard ran.
        expect(stagedClipCount()).toBe(1);
    });
});
