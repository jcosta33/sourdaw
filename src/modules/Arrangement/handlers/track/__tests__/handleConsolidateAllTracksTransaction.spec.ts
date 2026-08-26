import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { handleConsolidateAllTracks } from '../handleConsolidateAllTracks';

type CacheAudioBufferInput = {
    buffer: AudioBuffer;
    bufferId?: string;
};

type RenderGate = {
    /** Resolves once `bounceTrack` has requested this render. */
    started: Promise<void>;
    /** Lets the render complete with a buffer. */
    release: () => void;
};

const mocks = vi.hoisted(() => ({
    cacheAudioBuffer: vi.fn<(input: CacheAudioBufferInput) => string>(),
    renderTrackOffline:
        vi.fn<(track: unknown, startBeat: number, endBeat: number, options?: unknown) => Promise<AudioBuffer | null>>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The offline render is gated per call so a test can move project state
// between the loop's bounces; the engine graph itself is not under test here.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('../../../useCases/freezeBounce/renderOffline', () => ({
    renderTrackOffline: mocks.renderTrackOffline,
}));

const consolidateAction: Extract<AppAction, { type: 'consolidateAllTracks' }> = {
    type: 'consolidateAllTracks',
    payload: undefined,
};

function createFakeAudioBuffer(): AudioBuffer {
    const channelData = new Float32Array(128);
    return {
        duration: 1,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 2,
        sampleRate: 48000,
    } as unknown as AudioBuffer;
}

/**
 * Gates every render call: each resolves when the test releases it, and
 * each records when `bounceTrack` asked for it — the point after which that
 * track's bounce write has either landed (pre-fix, unscoped) or pended
 * (post-fix, inside the command's transaction). Renders auto-release unless
 * `shouldHold` claims their index.
 */
function gateRenders(renderGates: RenderGate[], shouldHold: (index: number) => boolean = () => false): void {
    mocks.renderTrackOffline.mockImplementation(() => {
        let markStarted!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const rendered = new Promise<AudioBuffer | null>((resolve) => {
            release = () => resolve(createFakeAudioBuffer());
        });
        const gate: RenderGate = { started, release };
        renderGates.push(gate);
        markStarted();
        if (!shouldHold(renderGates.length - 1)) {
            release();
        }
        return rendered;
    });
}

// Issue #2544 — `handleConsolidateAllTracks` awaits one bounce per track, so
// only the first runs while the command's storage transaction is still
// ambient; every later `bounceTrack` used to write unscoped, on its own frame.
// Two consequences, the second decisive: the consolidation persisted track by
// track as independent CRDT changes, and the command reported `written` for a
// transaction holding none of its writes — a commit-time validation failure
// then threw before the undo entry was recorded, with every track already
// consolidated on disk and no undo for it. These specs dispatch the real
// handler through the real `executeAppAction` against a fake CRDT port and
// hold both sides together: the transaction the command reports is the
// transaction that carries its writes, and the undo record exists exactly
// when they committed.
describe('handleConsolidateAllTracks storage transaction (issue #2544)', () => {
    let doc: Record<string, unknown>;
    let trackMutations: string[];

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap({ consolidateAllTracks: handleConsolidateAllTracks });
        clearUndoHistory();
        agentProjectRepairStateStore.set(null);

        doc = {};
        trackMutations = [];
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ docId, changedKeys, changeFn }) => {
                changeFn(doc);
                if (docId === 'root' && changedKeys.includes('tracks')) {
                    trackMutations.push(JSON.stringify(doc.tracks));
                }
            },
        });

        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 't1',
                    kind: 'audio',
                    clips: [ClipDummy.create({ id: 'c1', trackId: 't1' })],
                }),
                TrackDummy.create({
                    id: 't2',
                    kind: 'audio',
                    clips: [ClipDummy.create({ id: 'c2', trackId: 't2' })],
                }),
            ],
            selectedTrackId: 't1',
            ghostClips: [],
        } satisfies TrackStoreState);
        // Commit the seed so the dispatch below starts from a persisted
        // baseline rather than from pending writes.
        flushAutomergeStorageWrites();

        mocks.cacheAudioBuffer.mockImplementation((input) => input.bufferId ?? 'generated-buffer-id');
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        agentProjectRepairStateStore.set(null);
    });

    async function flushOneFrame(): Promise<void> {
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    }

    it('commits every track of the consolidation as one change and records its undo entry', async () => {
        const renderGates: RenderGate[] = [];
        gateRenders(renderGates);

        await executeAppAction(consolidateAction);

        // The dispatch resolved, so the command's own commit already ran: the
        // document moved with both bounces in one change (seed + commit),
        // without waiting a frame for a stray write to follow.
        expect(trackMutations).toHaveLength(2);
        await flushOneFrame();
        expect(trackMutations).toHaveLength(2);

        expect(trackStore.value?.tracks).toHaveLength(2);
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.type).toBe('audio');
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).not.toBe('c1');
        expect(trackStore.value?.tracks[1]?.clips[0]?.id).not.toBe('c2');

        // The undo unit exists exactly because its writes committed.
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Consolidate all tracks');
    });

    it('leaves the project untouched, with no undo entry, when commit validation fails mid-loop', async () => {
        const seed = trackMutations[0];
        if (seed === undefined) {
            throw new Error('Expected the seed write to have reached the document');
        }

        const renderGates: RenderGate[] = [];
        // Hold the second render so the repair state can move in the window
        // between the two bounces.
        gateRenders(renderGates, (index) => index === 1);

        const dispatch = executeAppAction(consolidateAction);
        // The first bounce has fully landed by the time the second render is
        // requested — the exact window a rolling-back command used to lose it in.
        await vi.waitFor(() => {
            if (!renderGates[1]) {
                throw new Error('second render was not requested');
            }
        });
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        renderGates[1]!.release();

        await expect(dispatch).rejects.toThrow('Project repair is required before project actions can execute');
        await flushOneFrame();
        flushAutomergeStorageWrites();

        // Nothing persisted: the seed is still the whole truth of the slot...
        expect(trackMutations).toHaveLength(1);
        expect(trackMutations[0]).toBe(seed);
        // ...the store rolled back to it rather than holding a half-written
        // consolidation...
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('c1');
        expect(trackStore.value?.tracks[1]?.clips[0]?.id).toBe('c2');
        // ...and the undo entry that would have covered the destroyed clips
        // was never recorded — the failure is atomic, not a lost undo.
        expect(undoStore.value?.past).toHaveLength(0);
    });
});
