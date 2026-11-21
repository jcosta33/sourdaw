import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { handleBounceInPlace } from '../bounceInPlace';
import { handleBounceToNewTrack } from '../bounceToNewTrack';

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

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('../../../useCases/freezeBounce/renderOffline', () => ({
    renderTrackOffline: mocks.renderTrackOffline,
}));

const bounceInPlaceAction: Extract<AppAction, { type: 'bounceInPlace' }> = {
    type: 'bounceInPlace',
    payload: { trackId: 't1' },
};

const bounceToNewTrackAction: Extract<AppAction, { type: 'bounceToNewTrack' }> = {
    type: 'bounceToNewTrack',
    payload: { trackId: 't1' },
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
 * Gates the render: it resolves only when the test releases it, and records
 * when `bounceTrack` asked for it — the window in which a commit-time
 * admission flip lands while the write merely pends in the transaction.
 */
function gateRender(renderGates: RenderGate[]): void {
    mocks.renderTrackOffline.mockImplementation(() => {
        let markStarted!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const rendered = new Promise<AudioBuffer | null>((resolve) => {
            release = () => resolve(createFakeAudioBuffer());
        });
        renderGates.push({ started, release });
        markStarted();
        return rendered;
    });
}

// The standalone bounce commands are `undoable: false`, so the
// `pushUndoEntry('Bounce Track', …)` callback entry is their ONLY undo
// mechanism. That entry used to be filed inside `execute`, at a moment when
// the bounce write merely pends in the dispatching command's transaction: a
// commit-time abort rolled the write back but nothing retracted the entry,
// leaving a phantom history step — undo consumed it as a no-op, and redo ran
// the closure directly, an unscoped `trackStore.set` that resurrected the
// bounce and persisted it outside any transaction. The handlers now file the
// entry from `afterCommit`/`afterAmbiguousCommit`, the hooks the contract
// reserves for effects that must happen only after the owning project
// transaction commits, so the pair holds in every outcome.
describe('standalone bounce undo-entry/commit pairing (issue #2544 repair)', () => {
    let doc: Record<string, unknown>;
    let trackMutations: string[];

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap({
            bounceInPlace: handleBounceInPlace,
            bounceToNewTrack: handleBounceToNewTrack,
        });
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

    it('bounceInPlace records no undo entry when its transaction aborts at commit, and redo cannot resurrect the bounce', async () => {
        const seed = trackMutations[0];
        if (seed === undefined) {
            throw new Error('Expected the seed write to have reached the document');
        }

        const renderGates: RenderGate[] = [];
        gateRender(renderGates);

        const dispatch = executeAppAction(bounceInPlaceAction);
        await vi.waitFor(() => {
            if (!renderGates[0]) {
                throw new Error('render was not requested');
            }
        });
        // Flip the admission the commit validators read, while the render is
        // still pending — the write will pend in a transaction that is about
        // to refuse to commit it.
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        renderGates[0]!.release();

        await expect(dispatch).rejects.toThrow('Project repair is required before project actions can execute');
        await flushOneFrame();
        flushAutomergeStorageWrites();

        // The write rolled back and NO history step survived it: the undo
        // stack is empty, so undo has no phantom step to consume...
        expect(undoStore.value?.past).toHaveLength(0);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('c1');
        expect(trackMutations).toHaveLength(1);
        expect(trackMutations[0]).toBe(seed);

        // ...and walking undo/redo over the empty stack cannot resurrect the
        // bounced clips or persist them outside the aborted transaction.
        await undo();
        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('c1');
        expect(trackMutations).toHaveLength(1);
    });

    it('bounceToNewTrack records no undo entry when its transaction aborts at commit, and redo cannot resurrect the track', async () => {
        const renderGates: RenderGate[] = [];
        gateRender(renderGates);

        const dispatch = executeAppAction(bounceToNewTrackAction);
        await vi.waitFor(() => {
            if (!renderGates[0]) {
                throw new Error('render was not requested');
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
        renderGates[0]!.release();

        await expect(dispatch).rejects.toThrow('Project repair is required before project actions can execute');
        await flushOneFrame();
        flushAutomergeStorageWrites();

        expect(undoStore.value?.past).toHaveLength(0);
        // The bounce track was never created, and cannot be resurrected.
        expect(trackStore.value?.tracks).toHaveLength(1);
        await undo();
        await redo();
        expect(trackStore.value?.tracks).toHaveLength(1);
    });

    it('bounceInPlace still files its entry after a clean commit, and that entry undoes and redoes the bounce', async () => {
        mocks.renderTrackOffline.mockResolvedValue(createFakeAudioBuffer());

        await executeAppAction(bounceInPlaceAction);

        // The entry exists exactly because the write committed.
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Bounce Track');
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).not.toBe('c1');

        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('c1');

        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).not.toBe('c1');
    });

    it('bounceToNewTrack still files its entry after a clean commit, and undo removes the created track', async () => {
        mocks.renderTrackOffline.mockResolvedValue(createFakeAudioBuffer());

        await executeAppAction(bounceToNewTrackAction);

        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Bounce Track');
        expect(trackStore.value?.tracks).toHaveLength(2);

        await undo();
        expect(trackStore.value?.tracks).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('c1');
    });
});
