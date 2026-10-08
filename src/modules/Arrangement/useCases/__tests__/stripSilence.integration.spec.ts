import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    getMacroHandlers,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { handleRestoreStripSilenceState } from '../../handlers/clip/handleRestoreStripSilenceState';
import { handleStripSilence } from '../../handlers/clip/handleStripSilence';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';
import { trackStore } from '../../stores/trackStore';
import { setWarpState, warpStates } from '../../stores/warpStates';
import { prepareStripSilence } from '../prepareStripSilence';
import { restoreStripSilenceState } from '../restoreStripSilenceState';
import { stripSilence } from '../stripSilence';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

function createTestAudioBuffer(channelData: Float32Array<ArrayBuffer>): AudioBuffer {
    const sampleRate = 100;
    return {
        copyFromChannel: (destination, _channelNumber, startInChannel = 0) => {
            destination.set(channelData.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, _channelNumber, startInChannel = 0) => {
            channelData.set(source, startInChannel);
        },
        duration: channelData.length / sampleRate,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 1,
        sampleRate,
    };
}

/**
 * At 600 BPM a beat is 0.1s, so the 100 Hz fixture buffer runs at exactly 10
 * samples per beat. The buffer is 20 beats long; the clip under test spans
 * timeline [16, 26] with `audioOffsetBeats` 3, so it plays buffer beats
 * [3, 13) and nothing else.
 */
const FIXTURE_TEMPO = 600;
const SAMPLES_PER_BEAT = 10;
const CLIP_START_BEAT = 16;
const CLIP_AUDIO_OFFSET_BEATS = 3;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

/**
 * Sound at buffer beats [0,2), [4,6) and [10,13). The first block is BEFORE
 * the played window and must never be seen. The other two played at timeline
 * [17,19) and [23,26), which is exactly where their segments must land.
 */
function twoRegionChannelData(): Float32Array<ArrayBuffer> {
    const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 0 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 4 * SAMPLES_PER_BEAT, 6 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 10 * SAMPLES_PER_BEAT, 13 * SAMPLES_PER_BEAT);
    return channelData;
}

type AutomationLanePoints = NonNullable<typeof automationStore.value>['lanes'][number]['points'];

/** One clip-scoped lane on the target clip, with the given absolute-beat points. */
function setClipAutomationLane(laneId: string, points: AutomationLanePoints): void {
    automationStore.set({
        lanes: [
            {
                id: laneId,
                trackId: 'track-1',
                clipId: 'clip-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points,
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    });
}

describe('stripSilence satellite migration (ledger #2108)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('strip silence integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap({
            stripSilence: handleStripSilence,
            restoreStripSilenceState: handleRestoreStripSilenceState,
        });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setNotificationEventBus(createEventBus<NotificationEvents>());
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, tempo: FIXTURE_TEMPO });
        const source = ClipDummy.create({
            id: 'clip-1',
            trackId: 'track-1',
            audioBufferId: 'buf-1',
            startBeat: CLIP_START_BEAT,
            endBeat: CLIP_START_BEAT + 10,
            audioOffsetBeats: CLIP_AUDIO_OFFSET_BEATS,
        });
        const { audioOffsetBeats, ...clipWithoutOffset } = source;
        const clip = { ...clipWithoutOffset, overrides: { gain: true }, audioOffsetBeats, kneadState: undefined };
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: 'track-1', ghostClips: [] });
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(twoRegionChannelData()));
        automationStore.set({ lanes: [] });
        __resetGainEnvelopesForTest();
        warpStates.clear();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        Container.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        __resetGainEnvelopesForTest();
        warpStates.clear();
        transportStore.set(defaultTransportState);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('places every segment on the audio it already played (regression #2108)', () => {
        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        expect(clips).toHaveLength(2);
        // Audible-playback equivalence: before the strip, timeline beat 17 of
        // this clip played buffer beat 4 and timeline beat 23 played buffer
        // beat 10. Each segment must sit at that timeline position AND read
        // from that same buffer beat.
        expect(clips[0]).toMatchObject({ startBeat: 17, endBeat: 19, audioOffsetBeats: 4 });
        expect(clips[1]).toMatchObject({ startBeat: 23, endBeat: 26, audioOffsetBeats: 10 });
        expect(clips.map((clip) => clip.id)).not.toContain('clip-1');
    });

    it('round-trips prepared segments with overrides and an offset after their decoded key order changes', () => {
        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();

        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
        const appliedSegment = trackStore.value!.tracks[0]!.clips[0]!;
        expect(appliedSegment.overrides).toEqual({ gain: true });
        expect(Object.keys(appliedSegment).indexOf('overrides')).toBeGreaterThan(
            Object.keys(appliedSegment).indexOf('audioOffsetBeats')
        );

        expect(restoreStripSilenceState({ expected: plan!.next, replacement: plan!.previous })).toBe(true);
        expect(trackStore.value!.tracks[0]!.clips).toHaveLength(1);
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
    });

    it('round-trips decoded replacement clips through command undo and redo and refuses changed content', async () => {
        await executeAppAction({ type: 'stripSilence', payload: { clipId: 'clip-1' } });
        flushAutomergeStorageWrites();
        trackStore.hydrate();

        const segments = structuredClone(trackStore.value!.tracks[0]!.clips);
        expect(segments).toHaveLength(2);
        expect(segments.every((clip) => !Object.hasOwn(clip, 'kneadState'))).toBe(true);
        expect(segments.map((clip) => clip.overrides)).toEqual([{ gain: true }, { gain: true }]);

        expect(await undo()).toEqual({ headConsumed: true });
        flushAutomergeStorageWrites();
        trackStore.hydrate();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-1', audioOffsetBeats: CLIP_AUDIO_OFFSET_BEATS, overrides: { gain: true } },
        ]);

        await redo();
        flushAutomergeStorageWrites();
        trackStore.hydrate();
        expect(trackStore.value!.tracks[0]!.clips).toEqual(segments);

        const changedState = structuredClone(trackStore.value!);
        changedState.tracks[0]!.clips[0]!.overrides = { gain: false };
        trackStore.set(changedState);
        flushAutomergeStorageWrites();
        trackStore.hydrate();
        const beforeRefusedUndo = structuredClone(trackStore.value);

        expect(await undo()).toEqual({ headConsumed: false });
        expect(trackStore.value).toEqual(beforeRefusedUndo);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('refuses a changed segment value without moving the prepared transition', () => {
        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
        const state = trackStore.value!;
        const changedClips = state.tracks[0]!.clips.map((clip, index) => (index === 0 ? { ...clip, gain: 0.5 } : clip));
        trackStore.set({ ...state, tracks: [{ ...state.tracks[0]!, clips: changedClips }] });

        expect(restoreStripSilenceState({ expected: plan!.next, replacement: plan!.previous })).toBe(false);
        expect(trackStore.value!.tracks[0]!.clips[0]!.gain).toBe(0.5);
    });

    it('broadcasts the gain envelope, rebased, to every new segment and clears the target id (regression #2108)', () => {
        setEnvelope('clip-1', {
            clipId: 'clip-1',
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: 1, gainDb: -6 },
                { id: 'p-late', beatOffset: 8, gainDb: -3 },
            ],
        });

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        expect(getEnvelope('clip-1')).toBeUndefined();
        // First segment starts 1 beat into the target -> every point shifts
        // back by 1.
        expect(getEnvelope(first!.id)).toEqual({
            clipId: first!.id,
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: 0, gainDb: -6 },
                { id: 'p-late', beatOffset: 7, gainDb: -3 },
            ],
        });
        // Second segment starts 7 beats into the target -> shift back by 7.
        expect(getEnvelope(second!.id)).toEqual({
            clipId: second!.id,
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: -6, gainDb: -6 },
                { id: 'p-late', beatOffset: 1, gainDb: -3 },
            ],
        });
    });

    it('broadcasts the warp state unshifted so markers stay on source-content beats (regression #2866)', () => {
        const warpState = {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 2, warpedBeat: 3 }],
            stretchMode: 'wsola' as const,
            originalTempo: 120,
        };
        setWarpState('clip-1', warpState);

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        expect(warpStates.has('clip-1')).toBe(false);
        expect(warpStates.get(first!.id)).toEqual(warpState);
        expect(warpStates.get(second!.id)).toEqual(warpState);
    });

    it('re-keys a clip-scoped automation lane to the LATER segment holding its points, verbatim (regression #2108)', () => {
        // Absolute timeline beat 24 sits inside the second segment [23, 26].
        // Points are never rebased: `applyAutomation` evaluates them at the
        // playhead's absolute beat.
        setClipAutomationLane('lane-a', [{ id: 'point-a', beat: 24, value: 0.5, curve: 'linear', tension: 0.5 }]);

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        const lanes = automationStore.value!.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes[0]).toMatchObject({
            clipId: second!.id,
            points: [{ id: 'point-a', beat: 24, value: 0.5 }],
        });
        expect(lanes[0]!.id).not.toBe('lane-a');
        expect(lanes.some((lane) => lane.clipId === first!.id)).toBe(false);
    });

    it('splits one lane across every segment its points reach (regression #2108)', () => {
        setClipAutomationLane('lane-split', [
            { id: 'point-first', beat: 18, value: 0.25, curve: 'linear', tension: 0 },
            // Beat 21 is inside the stripped silence — no surviving clip owns
            // that moment, so this point retires with the audio.
            { id: 'point-gone', beat: 21, value: 0.5, curve: 'linear', tension: 0 },
            { id: 'point-second', beat: 24, value: 0.75, curve: 'linear', tension: 0 },
        ]);

        expect(stripSilence('clip-1')).toBe(true);

        const [first, second] = trackStore.value!.tracks[0]!.clips;
        const lanes = automationStore.value!.lanes;
        expect(lanes).toHaveLength(2);
        expect(lanes.find((lane) => lane.clipId === first!.id)!.points).toEqual([
            { id: 'point-first', beat: 18, value: 0.25, curve: 'linear', tension: 0 },
        ]);
        expect(lanes.find((lane) => lane.clipId === second!.id)!.points).toEqual([
            { id: 'point-second', beat: 24, value: 0.75, curve: 'linear', tension: 0 },
        ]);
    });

    it('retires a clip-scoped automation lane whose points fall in stripped silence instead of stranding it (regression #2108)', () => {
        // Beat 21 is between the two segments — the audio that carried it is
        // gone, so there is no clip window left to evaluate it in.
        setClipAutomationLane('lane-b', [{ id: 'point-b', beat: 21, value: 0.5, curve: 'linear', tension: 0.5 }]);

        expect(stripSilence('clip-1')).toBe(true);

        expect(automationStore.value!.lanes).toEqual([]);
    });

    it('round-trips a populated clip-scoped lane through undo (regression #2108)', async () => {
        const { prepareStripSilence } = await import('../prepareStripSilence');
        const { restoreStripSilenceState } = await import('../restoreStripSilenceState');
        const originalPoints: AutomationLanePoints = [
            { id: 'point-a', beat: 24, value: 0.5, curve: 'linear', tension: 0.5 },
        ];
        setClipAutomationLane('lane-a', originalPoints);

        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
        expect(automationStore.value!.lanes[0]!.id).not.toBe('lane-a');

        // Undo compares the live lane against `plan.next` by JSON — the only
        // path where that comparison meets a populated lane read back out of
        // the store.
        expect(restoreStripSilenceState({ expected: plan!.next, replacement: plan!.previous })).toBe(true);
        expect(automationStore.value!.lanes).toHaveLength(1);
        expect(automationStore.value!.lanes[0]).toMatchObject({
            id: 'lane-a',
            clipId: 'clip-1',
            points: originalPoints,
        });
    });

    describe('a strip carrying its plan', () => {
        function planStrip(): Extract<AppAction, { type: 'stripSilence' }> {
            const action: Extract<AppAction, { type: 'stripSilence' }> = {
                type: 'stripSilence',
                payload: { clipId: 'clip-1' },
            };
            handleStripSilence.materializeCommandArguments?.(action);
            if (!action.payload.expected || !action.payload.replacement) {
                throw new Error('Expected a planned strip');
            }
            return action;
        }

        // Red when materialize or describe plan again: each pass would draw new segment clip ids
        // and new lane ids, so the arguments would drift from what the command recorded.
        it('names the recorded segment and lane ids on every later materialize, describe and execute', async () => {
            setClipAutomationLane('lane-split', [
                { id: 'point-first', beat: 18, value: 0.25, curve: 'linear', tension: 0 },
                { id: 'point-second', beat: 24, value: 0.75, curve: 'linear', tension: 0 },
            ]);
            const action = planStrip();
            const recorded = structuredClone(action);
            const recordedSegmentIds = recorded.payload.replacement!.clips.map((clip) => clip.id);
            const recordedLaneIds = recorded.payload.replacement!.clipAutomationLanes.map((lane) => lane.id);
            expect(recordedSegmentIds).toHaveLength(2);
            expect(recordedLaneIds).toHaveLength(2);

            handleStripSilence.materializeCommandArguments?.(action);
            const firstDescription = handleStripSilence.describe(action);
            handleStripSilence.materializeCommandArguments?.(action);
            const secondDescription = handleStripSilence.describe(action);

            expect(action).toEqual(recorded);
            expect(secondDescription).toEqual(firstDescription);
            expect(firstDescription.redoAction).toEqual({
                type: 'restoreStripSilenceState',
                payload: { expected: recorded.payload.expected, replacement: recorded.payload.replacement },
            });

            await executeAppAction(action);

            expect(trackStore.value!.tracks[0]!.clips.map((clip) => clip.id)).toEqual(recordedSegmentIds);
            expect(automationStore.value!.lanes.map((lane) => lane.id).toSorted()).toEqual(recordedLaneIds.toSorted());
        });

        // Red when the carried plan is applied without proving the project still yields it.
        it('refuses a carried plan once the target clip changed after it was planned, leaving the project unchanged', async () => {
            const action = planStrip();
            const state = trackStore.value!;
            trackStore.set({
                ...state,
                tracks: [
                    {
                        ...state.tracks[0]!,
                        clips: state.tracks[0]!.clips.map((clip) => ({ ...clip, gain: 0.5 })),
                    },
                ],
            });
            const tracksBefore = structuredClone(trackStore.value!.tracks);

            const result = await executeAppActionBatch([action], { source: 'prompt' });

            expect(result).toMatchObject({
                status: 'conflicted',
                reason: 'Action conflicts with current project state: stripSilence: The strip silence this command recorded no longer matches the project',
            });
            expect(trackStore.value!.tracks).toEqual(tracksBefore);
        });

        // Red when only the recorded previous state is compared: a replacement whose segments were
        // renamed would commit under the approved command's name.
        it('refuses a carried plan whose replacement was altered, leaving the project unchanged', async () => {
            const action = planStrip();
            action.payload.replacement = {
                ...action.payload.replacement!,
                clips: action.payload.replacement!.clips.map((clip) => ({ ...clip, name: 'Altered' })),
            };
            const tracksBefore = structuredClone(trackStore.value!.tracks);

            const result = await executeAppActionBatch([action], { source: 'prompt' });

            expect(result).toMatchObject({
                status: 'conflicted',
                reason: 'Action conflicts with current project state: stripSilence: The strip silence this command recorded no longer matches the project',
            });
            expect(trackStore.value!.tracks).toEqual(tracksBefore);
        });

        it('refuses a carried plan whose segment id another clip took since it was planned', async () => {
            const action = planStrip();
            const takenId = action.payload.replacement!.clips[0]!.id;
            const state = trackStore.value!;
            const other = TrackDummy.create({
                id: 'track-2',
                clips: [ClipDummy.create({ id: takenId, trackId: 'track-2', startBeat: 0, endBeat: 4 })],
            });
            trackStore.set({ ...state, tracks: [...state.tracks, other] });
            const tracksBefore = structuredClone(trackStore.value!.tracks);

            const result = await executeAppActionBatch([action], { source: 'prompt' });

            expect(result).toMatchObject({
                status: 'conflicted',
                reason: 'Action conflicts with current project state: stripSilence: The strip silence this command recorded no longer matches the project',
            });
            expect(trackStore.value!.tracks).toEqual(tracksBefore);
        });
    });

    // Red when macro replay keeps the recorded strip plan: the clip changed since recording, so the
    // carried plan is stale and the replay would be refused instead of planned against the project.
    it('re-plans a recorded strip macro against the clip as it now is', async () => {
        registerHandlerMap(getMacroHandlers());
        const recorded: Extract<AppAction, { type: 'stripSilence' }> = {
            type: 'stripSilence',
            payload: { clipId: 'clip-1' },
        };
        handleStripSilence.describe(recorded);
        if (!recorded.payload.expected || !recorded.payload.replacement) {
            throw new Error('Expected a planned strip');
        }
        const recordedSegmentIds = recorded.payload.replacement.clips.map((clip) => clip.id);
        expect(recordedSegmentIds).toHaveLength(2);
        macroStore.set({
            macros: [{ id: 'strip-macro', name: 'Strip', actions: [structuredClone(recorded)], createdAt: 1 }],
            recording: false,
            currentRecording: [],
        });
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: [
                {
                    ...state.tracks[0]!,
                    clips: state.tracks[0]!.clips.map((clip) => ({ ...clip, gain: 0.5 })),
                },
            ],
        });

        await executeAppAction({ type: 'playMacro', payload: { macroId: 'strip-macro' } });

        const clips = trackStore.value!.tracks[0]!.clips;
        expect(clips).toHaveLength(2);
        expect(clips.map((clip) => clip.id)).not.toContain('clip-1');
        expect(clips.map((clip) => clip.id)).not.toEqual(recordedSegmentIds);
        expect(clips).toMatchObject([
            { startBeat: 17, endBeat: 19, gain: 0.5 },
            { startBeat: 23, endBeat: 26, gain: 0.5 },
        ]);
    });

    it('round-trips the full satellite transition through undo (regression #2108)', async () => {
        const { prepareStripSilence } = await import('../prepareStripSilence');
        const { restoreStripSilenceState } = await import('../restoreStripSilenceState');
        setEnvelope('clip-1', { clipId: 'clip-1', enabled: true, points: [{ id: 'p1', beatOffset: 1, gainDb: -6 }] });

        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
        const segmentIds = trackStore.value!.tracks[0]!.clips.map((clip) => clip.id);
        expect(getEnvelope('clip-1')).toBeUndefined();
        expect(segmentIds.some((id) => getEnvelope(id) !== undefined)).toBe(true);

        // Undo: swap expected/replacement.
        expect(restoreStripSilenceState({ expected: plan!.next, replacement: plan!.previous })).toBe(true);
        const restoredClips = trackStore.value!.tracks[0]!.clips;
        expect(restoredClips).toHaveLength(1);
        expect(restoredClips[0]!.id).toBe('clip-1');
        expect(getEnvelope('clip-1')).toEqual({
            clipId: 'clip-1',
            enabled: true,
            points: [{ id: 'p1', beatOffset: 1, gainDb: -6 }],
        });
        for (const segmentId of segmentIds) {
            expect(getEnvelope(segmentId)).toBeUndefined();
        }
    });
});
