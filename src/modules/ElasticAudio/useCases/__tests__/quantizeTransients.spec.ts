import { load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { gainEnvelopeStore, takeLaneStore, trackStore, type Clip } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, readTransientQuantizeOutcome } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { projectOfflineAudioClipPlaybacks } from '#/modules/AudioEngine/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    getExecutableCommandRegistrations,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import {
    defaultTransportState,
    readSecondsAtBeat,
    readTempoAtBeat,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';
import { isRecord } from '#/utils/structuralEquality';

import { quantizeTransients } from '../quantizeTransients';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};
type QuantizeAction = Extract<AppAction, { type: 'quantizeTransients' }>;

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const TRACK_ID = 'track-drums';
const CLIP_ID = 'clip-loop';
const BUFFER_ID = 'buffer-loop';
const SAMPLE_RATE = 48_000;
const SOURCE_SECONDS = 4;
/** Where each hit's attack sits in the source, in seconds: off the grid by different amounts and directions. */
const ATTACK_SECONDS = [0.6, 1.45, 2.4, 3.15] as const;
/** The detector reports an onset up to one 2048-sample analysis frame before the attack it heard. */
const DETECTION_FRAME_SECONDS = 2048 / SAMPLE_RATE;

let stopProjectionBridge: () => void = () => undefined;

function drumLoopChannel(attacks: readonly number[] = ATTACK_SECONDS): Float32Array<ArrayBuffer> {
    const samples = new Float32Array(SAMPLE_RATE * SOURCE_SECONDS);
    for (const attack of attacks) {
        const start = Math.round(attack * SAMPLE_RATE);
        for (let index = 0; index < 400; index++) {
            samples[start + index] = Math.cos(index * 1.723) * Math.exp(-index / 60);
        }
    }
    return samples;
}

function fakeBuffer(channel: Float32Array<ArrayBuffer>, length = channel.length): AudioBuffer {
    return {
        getChannelData: () => channel,
        length,
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
        duration: length / SAMPLE_RATE,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    };
}

function loopClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: CLIP_ID,
        trackId: TRACK_ID,
        name: 'Loose loop',
        type: 'audio',
        audioBufferId: BUFFER_ID,
        audioOffsetSeconds: 0,
        startBeat: 0,
        endBeat: 8,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function seedProject(clip: Clip, channel = drumLoopChannel()): void {
    trackStore.set({
        tracks: [{ ...createTrack({ id: TRACK_ID, name: 'Drums', kind: 'audio' }), clips: [clip] }],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
    vi.spyOn(audioBufferCache, 'get').mockReturnValue(fakeBuffer(channel));
    flushAutomergeStorageWrites();
    stopProjectionBridge = setupProjectionBridge();
    projectCrdtToStores();
}

function hydrateProductionContracts(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getProjectHandlers(),
        getTransportHandlers(),
        getYeastHandlers(),
    ]);
}

function reloadSavedProject(): void {
    flushAutomergeStorageWrites();
    const current = getCrdtDoc('root');
    if (!current) {
        throw new Error('Expected a project to save');
    }
    replaceCrdtDocInLineage({ id: 'root', doc: load(save(current)) });
    projectCrdtToStores({ resetProjections: true });
    hydrateProductionContracts();
}

function persistedUndoLengths(): { past: number; future: number } {
    const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.past) || !Array.isArray(parsed.future)) {
        return { past: -1, future: -1 };
    }
    return { past: parsed.past.length, future: parsed.future.length };
}

function trackClips(): Clip[] {
    return structuredClone(trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? []);
}

/** The quantize the latest undo entry committed, with the plan its handler materialized. */
function committedQuantize(): QuantizeAction {
    const entry = undoHistoryStore.value?.past.at(-1);
    if (entry?.kind !== 'action' || entry.action.type !== 'quantizeTransients') {
        throw new Error('Expected a committed transient quantize');
    }
    return structuredClone(entry.action);
}

function committedMoves() {
    const outcome = readTransientQuantizeOutcome(committedQuantize().payload);
    if (!outcome) {
        throw new Error('Expected a planned transient quantize');
    }
    return outcome;
}

/** Exactly what the offline render (and so the export) plays for one clip. */
function playbackOf(clip: Clip) {
    const [playback, ...rest] = projectOfflineAudioClipPlaybacks({
        clip,
        bufferDurationSeconds: SOURCE_SECONDS,
        regionStartBeat: 0,
        regionStartSec: 0,
        durationSeconds: 60,
        compensationDelay: 0,
        projectBeatToSeconds: (beat) => readSecondsAtBeat({ beat }),
        resolveTempoAtBeat: (beat) => readTempoAtBeat({ beat }),
    });
    if (!playback || rest.length > 0) {
        throw new Error(`Expected one playback of ${clip.id}`);
    }
    return playback;
}

function sliceOf(clipId: string): Clip {
    const slice = trackClips().find((clip) => clip.id === clipId);
    if (!slice) {
        throw new Error(`Expected slice ${clipId}`);
    }
    return slice;
}

/**
 * Every moved slice plays from its onset's exact source second and starts on its grid beat, in the
 * render the export runs.
 */
function expectSlicesPlayFromOnsetsOnTheirGrid(expectedGridBeats: readonly number[]): void {
    const { moves } = committedMoves();
    expect(moves.map((move) => move.toBeat)).toEqual(expectedGridBeats);
    for (const move of moves) {
        const slice = sliceOf(move.sliceClipId);
        const playback = playbackOf(slice);
        expect(slice.startBeat).toBe(move.toBeat);
        expect(playback.startSec).toBeCloseTo(readSecondsAtBeat({ beat: move.toBeat }), 9);
        expect(playback.bufferOffsetSec).toBe(move.sourceSeconds);
    }
}

describe('quantizeTransients (AC-002: separate and conform an audio clip to the grid)', () => {
    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(createEventBus<NotificationEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('transient quantize');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        automationStore.set({ lanes: [] });
        hydrateProductionContracts();
    });

    afterEach(() => {
        stopProjectionBridge();
        stopProjectionBridge = () => undefined;
        vi.restoreAllMocks();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        tempoMapStore.set({ changes: [] });
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('cuts at every hit and lands each one on the grid under a flat tempo', async () => {
        seedProject(loopClip());

        await quantizeTransients(CLIP_ID, 1);

        // Hits heard at beats 1.2, 2.9, 4.8 and 6.3 move to 1, 3, 5 and 6.
        expectSlicesPlayFromOnsetsOnTheirGrid([1, 3, 5, 6]);
        const clips = trackClips();
        expect(clips).toHaveLength(5);
        expect(clips[0]).toMatchObject({ id: CLIP_ID, startBeat: 0, endBeat: 1, audioOffsetSeconds: 0 });
    });

    it('places every slice on the grid across a tempo change', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'tempo-120', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-60', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        // Four seconds of source last eight beats at 120 BPM but six beats here: 4 at 120, 2 at 60.
        seedProject(loopClip({ endBeat: 6 }));

        await quantizeTransients(CLIP_ID, 1);

        // Hits heard at beats 1.2, 2.9, 4.4 and 5.15 move to 1, 3, 4 and 5.
        expectSlicesPlayFromOnsetsOnTheirGrid([1, 3, 4, 5]);
        expect(playbackOf(sliceOf(committedMoves().moves[3]!.sliceClipId)).startSec).toBeCloseTo(3, 9);
    });

    it('places every slice on the grid while the clip is time-stretched', async () => {
        // Half-speed stretch: the four source seconds span sixteen beats, so each hit sits at four times its second.
        seedProject(loopClip({ endBeat: 16, stretchMode: 'timestretch', stretchRatio: 0.5 }));

        await quantizeTransients(CLIP_ID, 2);

        expectSlicesPlayFromOnsetsOnTheirGrid([2, 6, 10, 12]);
        for (const move of committedMoves().moves) {
            expect(playbackOf(sliceOf(move.sliceClipId)).playbackRate).toBe(0.5);
        }
    });

    it.each([
        { label: 'half strength moves each hit halfway', gridSize: 1, strength: 0.5, swing: 0, grid: [1, 3, 5, 6] },
        {
            label: 'full swing delays the off-beat points',
            gridSize: 0.5,
            strength: 1,
            swing: 1,
            grid: [1, 2.75, 4.75, 6],
        },
    ])('$label', async ({ gridSize, strength, swing, grid }) => {
        seedProject(loopClip());

        await executeAppAction({
            type: 'quantizeTransients',
            payload: { clipId: CLIP_ID, gridSize, strength, swing },
        });

        const { moves } = committedMoves();
        expect(moves).toHaveLength(grid.length);
        for (const [index, move] of moves.entries()) {
            expect(move.toBeat).toBeCloseTo(move.fromBeat + (grid[index]! - move.fromBeat) * strength, 12);
            expect(sliceOf(move.sliceClipId).startBeat).toBe(move.toBeat);
        }
    });

    it('merges a hit whose grid point does not advance past the slice before it, and reports it', async () => {
        seedProject(loopClip());

        await quantizeTransients(CLIP_ID, 2);

        // The hits at 1.2 and 2.9 both round to beat 2: the second stays inside the first slice.
        const outcome = committedMoves();
        expect(outcome.moves.map((move) => [move.onsetIndex, move.toBeat])).toEqual([
            [0, 2],
            [2, 4],
            [3, 6],
        ]);
        expect(outcome.skipped).toEqual([{ onsetIndex: 1, reason: 'merged' }]);
        expect(trackClips()).toHaveLength(4);
    });

    it('leaves the audio after a range that ends inside the clip where it was', async () => {
        seedProject(loopClip());

        await executeAppAction({
            type: 'quantizeTransients',
            payload: { clipId: CLIP_ID, gridSize: 1, startBeat: 0, endBeat: 4 },
        });

        // Only the hits at 1.2 and 2.9 move; the cut at beat 4 keeps the hits at 4.8 and 6.3 unmoved.
        expectSlicesPlayFromOnsetsOnTheirGrid([1, 3]);
        const clips = trackClips();
        expect(clips).toHaveLength(4);
        const tail = clips.at(-1)!;
        expect(tail).toMatchObject({ startBeat: 4, endBeat: 8, audioOffsetSeconds: 2 });
        expect(playbackOf(tail).startSec).toBeCloseTo(2, 9);
        expect(playbackOf(tail).bufferOffsetSec).toBe(2);
        expect(sliceOf(committedMoves().moves[1]!.sliceClipId).endBeat).toBe(4);
    });

    // The attack at 2.06 s is heard at beat ~4.07 and the one at 3.15 s at ~6.25; both grid points are on beats.
    const RANGE_START_ATTACKS = [2.06, 3.15];

    function quantizeFromRangeStart(startBeat: number, strength: number) {
        seedProject(loopClip(), drumLoopChannel(RANGE_START_ATTACKS));
        return executeAppAction({
            type: 'quantizeTransients',
            payload: { clipId: CLIP_ID, gridSize: 1, strength, startBeat },
        });
    }

    it.each([1, 0.5])(
        'never moves a hit before a range that starts off the grid inside the clip (strength %s)',
        async (strength) => {
            await quantizeFromRangeStart(4.05, strength);

            // The hit at ~4.07 would move toward beat 4, before the range start: it stays where it is.
            const outcome = committedMoves();
            expect(outcome.skipped).toEqual([{ onsetIndex: 0, reason: 'merged' }]);
            expect(outcome.moves.map((move) => move.onsetIndex)).toEqual([1]);
            const [move] = outcome.moves;
            expect(move!.toBeat).toBeCloseTo(move!.fromBeat + (6 - move!.fromBeat) * strength, 12);
            const [head, rangeStart] = trackClips();
            // Everything before the range start plays as it did: the head runs to 4.05, the cut there is unmoved.
            expect(head).toMatchObject({ id: CLIP_ID, startBeat: 0, endBeat: 4.05, audioOffsetSeconds: 0 });
            expect(rangeStart).toMatchObject({ startBeat: 4.05, audioOffsetSeconds: (4.05 * 60) / 120 });
        }
    );

    it.each([1, 0.5])('lets a hit land on a range start on the grid (strength %s)', async (strength) => {
        await quantizeFromRangeStart(4, strength);

        const outcome = committedMoves();
        expect(outcome.skipped).toEqual([]);
        const [first] = outcome.moves;
        expect(first!.onsetIndex).toBe(0);
        expect(first!.toBeat).toBeCloseTo(first!.fromBeat + (4 - first!.fromBeat) * strength, 12);
        expect(first!.toBeat).toBeGreaterThanOrEqual(4);
        // The head plays unmoved up to the range start and no slice starts before it.
        const [head, ...rest] = trackClips();
        expect(head).toMatchObject({ id: CLIP_ID, startBeat: 0, audioOffsetSeconds: 0 });
        expect(head!.endBeat).toBeGreaterThanOrEqual(4);
        expect(head!.endBeat).toBeLessThanOrEqual(first!.toBeat);
        for (const slice of rest) {
            expect(slice.startBeat).toBeGreaterThanOrEqual(4);
        }
    });

    it('cuts a stretched clip where its range ends at the source second that beat plays', async () => {
        // Half-speed stretch: beat 7 is 3.5 song seconds in, which plays 1.75 seconds of source.
        seedProject(loopClip({ endBeat: 16, stretchMode: 'timestretch', stretchRatio: 0.5 }));

        await executeAppAction({
            type: 'quantizeTransients',
            payload: { clipId: CLIP_ID, gridSize: 2, endBeat: 7 },
        });

        expectSlicesPlayFromOnsetsOnTheirGrid([2, 6]);
        const tail = trackClips().at(-1)!;
        expect(tail).toMatchObject({ startBeat: 7, endBeat: 16 });
        expect(tail.audioOffsetSeconds).toBe(1.75);
    });

    it('cuts a clip entered mid-file where its range ends at the source second that beat plays', async () => {
        // The clip enters the file at 1 s on beat 2, so beat 5.5 plays 1 + 3.5 beats (1.75 s) = 2.75 s of source.
        seedProject(loopClip({ startBeat: 2, endBeat: 8, audioOffsetSeconds: 1 }));

        await executeAppAction({
            type: 'quantizeTransients',
            payload: { clipId: CLIP_ID, gridSize: 1, endBeat: 5.5 },
        });

        expectSlicesPlayFromOnsetsOnTheirGrid([3, 5]);
        const tail = trackClips().at(-1)!;
        expect(tail).toMatchObject({ startBeat: 5.5, endBeat: 8 });
        expect(tail.audioOffsetSeconds).toBe(2.75);
    });

    it('trims a slice the next one overlaps and leaves the gap a slice leaves silent', async () => {
        seedProject(loopClip());

        await quantizeTransients(CLIP_ID, 1);

        const [head, ...slices] = trackClips();
        const { moves } = committedMoves();
        expect(head).toMatchObject({ startBeat: 0, endBeat: 1 });
        // The hit at 2.9 moved to 3 but the one before it only plays to its own next hit: silence fills 2.7-3.
        const first = sliceOf(moves[0]!.sliceClipId);
        expect(first.endBeat).toBeCloseTo(1 + 2 * (moves[1]!.sourceSeconds - moves[0]!.sourceSeconds), 9);
        expect(first.endBeat).toBeLessThan(3);
        // The hit at 4.8 moved to 5 and would play past 6, where the next hit now starts: it is cut there.
        expect(sliceOf(moves[2]!.sliceClipId).endBeat).toBe(6);
        // The last slice runs out of source at 7.75 and never past the original clip end.
        expect(sliceOf(moves[3]!.sliceClipId).endBeat).toBeLessThanOrEqual(8);
        for (const [index, slice] of slices.entries()) {
            const previous = index === 0 ? head! : slices[index - 1]!;
            expect(previous.endBeat).toBeLessThanOrEqual(slice.startBeat);
        }
    });

    it('undoes to the original clip in one step and redoes the same slices', async () => {
        seedProject(loopClip());
        const before = trackClips();
        const pastBefore = undoStore.value?.past.length ?? 0;

        await quantizeTransients(CLIP_ID, 1);
        const after = trackClips();
        expect(undoStore.value?.past).toHaveLength(pastBefore + 1);
        expect(undoStore.value?.past.at(-1)?.label).toBe('Quantize transients');

        await undo();
        expect(trackClips()).toEqual(before);

        await redo();
        expect(trackClips()).toEqual(after);
    });

    it('keeps Undo and Redo working across a project reload', async () => {
        seedProject(loopClip());
        const before = trackClips();

        await quantizeTransients(CLIP_ID, 1);
        const after = trackClips();
        await vi.waitFor(() => expect(persistedUndoLengths().past).toBe(1));

        reloadSavedProject();
        expect((await undo()).headConsumed).toBe(true);
        expect(trackClips()).toEqual(before);
        await vi.waitFor(() => expect(persistedUndoLengths().future).toBe(1));

        reloadSavedProject();
        await redo();
        expect(trackClips()).toEqual(after);
    });

    it('drops a persisted quantize whose recorded move no longer heads its slice', async () => {
        seedProject(loopClip());
        await quantizeTransients(CLIP_ID, 1);
        await vi.waitFor(() => expect(persistedUndoLengths().past).toBe(1));
        const after = trackClips();

        const session: unknown = JSON.parse(sessionStorage.getItem(UNDO_SESSION_KEY) ?? 'null');
        const entry: unknown = isRecord(session) && Array.isArray(session.past) ? session.past[0] : null;
        const action: unknown = isRecord(entry) ? entry.action : null;
        const payload: unknown = isRecord(action) ? action.payload : null;
        const plan: unknown = isRecord(payload) ? payload.plan : null;
        const move: unknown = isRecord(plan) && Array.isArray(plan.moves) ? plan.moves[0] : null;
        if (!isRecord(move) || typeof move.toBeat !== 'number') {
            throw new Error('Expected a persisted transient quantize');
        }
        move.toBeat += 1;
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(session));

        reloadSavedProject();

        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
        expect(trackClips()).toEqual(after);
    });

    it('reads what the command moved and what it left uncut from its own arguments', async () => {
        seedProject(loopClip());

        await quantizeTransients(CLIP_ID, 1);

        const outcome = committedMoves();
        expect(outcome.clipId).toBe(CLIP_ID);
        expect(outcome.skipped).toEqual([]);
        expect(outcome.moves.map((move) => move.onsetIndex)).toEqual([0, 1, 2, 3]);
        for (const [index, move] of outcome.moves.entries()) {
            expect(move.fromBeat).toBeCloseTo(2 * move.sourceSeconds, 12);
            expect(move.sourceSeconds).toBeLessThan(ATTACK_SECONDS[index]!);
            expect(move.confidence).toBeGreaterThan(0);
        }
        expect(readTransientQuantizeOutcome({ clipId: CLIP_ID, gridSize: 1 })).toBeNull();
    });

    /**
     * The detector reports the start of the analysis frame its onset fell in, and that frame start
     * is what lands on the grid, so the attack itself is heard later by the distance between them.
     */
    it('states the onset bias: each hit is heard 1015-1527 samples (21-32 ms at 48 kHz) after its grid line', async () => {
        seedProject(loopClip());

        await quantizeTransients(CLIP_ID, 1);

        const biasSamples = committedMoves().moves.map((move, index) => {
            const playback = playbackOf(sliceOf(move.sliceClipId));
            const heardSec =
                playback.startSec + (ATTACK_SECONDS[index]! - playback.bufferOffsetSec) / playback.playbackRate;
            return Math.round((heardSec - readSecondsAtBeat({ beat: move.toBeat })) * SAMPLE_RATE);
        });
        for (const bias of biasSamples) {
            expect(bias).toBeGreaterThanOrEqual(1015);
            expect(bias).toBeLessThanOrEqual(1527);
            expect(bias / SAMPLE_RATE).toBeLessThan(DETECTION_FRAME_SECONDS);
        }
    });

    describe('refusals', () => {
        it.each<{ label: string; clip?: Partial<Clip>; payload?: Partial<QuantizeAction['payload']>; reason: string }>([
            { label: 'a MIDI clip', clip: { type: 'midi', audioBufferId: undefined }, reason: 'audio clips only' },
            { label: 'a locked clip', clip: { locked: true }, reason: 'locked' },
            { label: 'a looped clip', clip: { loopEnabled: true, loopLength: 8 }, reason: 'looped clip' },
            { label: 'a grid below 1/32 beat', payload: { gridSize: 1 / 64 }, reason: 'quantize grid' },
            { label: 'a grid above 4 beats', payload: { gridSize: 8 }, reason: 'quantize grid' },
            { label: 'a strength above 1', payload: { strength: 1.5 }, reason: 'between 0 and 1' },
            { label: 'an empty range', payload: { startBeat: 4, endBeat: 4 }, reason: 'end after it starts' },
            { label: 'a range holding no hit', payload: { startBeat: 7, endBeat: 7.5 }, reason: 'No transients' },
        ])('refuses $label and leaves the clip as it was', async ({ clip, payload, reason }) => {
            seedProject(loopClip(clip));
            const before = trackClips();

            await expect(
                executeAppAction({ type: 'quantizeTransients', payload: { clipId: CLIP_ID, gridSize: 1, ...payload } })
            ).rejects.toThrow(reason);

            expect(trackClips()).toEqual(before);
            expect(undoStore.value?.past ?? []).toHaveLength(0);
        });

        it('refuses a take clip', async () => {
            seedProject(loopClip());
            takeLaneStore.set({
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: TRACK_ID,
                        activeCompRegions: [],
                        takes: [
                            {
                                id: 'take-1',
                                clipId: CLIP_ID,
                                name: 'Take 1',
                                selected: true,
                                startBeat: 0,
                                endBeat: 8,
                            },
                        ],
                    },
                ],
            });

            await expect(
                executeAppAction({ type: 'quantizeTransients', payload: { clipId: CLIP_ID, gridSize: 1 } })
            ).rejects.toThrow('take or comped clip');
        });

        it('refuses a source longer than two minutes without analysing it', async () => {
            const channel = new Float32Array(1);
            seedProject(loopClip(), channel);
            vi.spyOn(audioBufferCache, 'get').mockReturnValue(fakeBuffer(channel, SAMPLE_RATE * 121));

            await expect(
                executeAppAction({ type: 'quantizeTransients', payload: { clipId: CLIP_ID, gridSize: 1 } })
            ).rejects.toThrow('120 seconds');
        });

        it('refuses a clip whose audio is not loaded', async () => {
            seedProject(loopClip());
            vi.spyOn(audioBufferCache, 'get').mockReturnValue(undefined);

            await expect(
                executeAppAction({ type: 'quantizeTransients', payload: { clipId: CLIP_ID, gridSize: 1 } })
            ).rejects.toThrow('not loaded');
        });

        it('refuses to follow an edit of the same clip in one batch', async () => {
            seedProject(loopClip());
            const before = trackClips();

            const result = await executeAppActionBatch([
                { type: 'setClipGain', payload: { clipId: CLIP_ID, gain: 0.5 } },
                { type: 'quantizeTransients', payload: { clipId: CLIP_ID, gridSize: 1 } },
            ]);

            expect(result).toMatchObject({ status: 'conflicted', reason: expect.stringContaining('same batch') });
            expect(trackClips()).toEqual(before);
        });

        it('refuses a carried plan once the clip changed, and once the decoded source changed', async () => {
            seedProject(loopClip());
            await quantizeTransients(CLIP_ID, 1);
            const recorded = committedQuantize();
            await undo();

            await executeAppAction({ type: 'setClipGain', payload: { clipId: CLIP_ID, gain: 0.5 } });
            const changed = trackClips();
            await expect(executeAppAction(structuredClone(recorded))).rejects.toThrow('no longer matches');
            expect(trackClips()).toEqual(changed);
            // Validation alone refuses it too, which is all an approval refresh asks before it executes.
            const handler = getExecutableCommandRegistrations().find(
                (registration) => registration.actionType === 'quantizeTransients'
            )?.handler;
            const context = { actions: [recorded], actionIndex: 0 };
            expect(handler?.validate?.(structuredClone(recorded), context)).toBe(false);
            expect(handler?.validationRefusalReason?.(structuredClone(recorded), context)).toContain(
                'no longer matches'
            );

            await undo();
            vi.spyOn(audioBufferCache, 'get').mockReturnValue(
                fakeBuffer(drumLoopChannel(), SAMPLE_RATE * SOURCE_SECONDS - 1)
            );
            await expect(executeAppAction(structuredClone(recorded))).rejects.toThrow('no longer matches');
        });

        it('applies a carried plan that is exactly what the project yields for its recorded ids', async () => {
            seedProject(loopClip());
            await quantizeTransients(CLIP_ID, 1);
            const recorded = committedQuantize();
            const after = trackClips();
            await undo();

            await executeAppAction(structuredClone(recorded));

            expect(trackClips()).toEqual(after);
            expect(committedQuantize().payload.plan).toEqual(recorded.payload.plan);
        });

        it('refuses a carried plan whose replacement is not the quantize it names, and writes nothing', async () => {
            seedProject(loopClip());
            await quantizeTransients(CLIP_ID, 1);
            const recorded = committedQuantize();
            await undo();
            const before = trackClips();
            const plan = recorded.payload.plan;
            const [head, firstSlice, ...laterSlices] = plan?.replacement.clips ?? [];
            if (!plan || !head || !firstSlice) {
                throw new Error('Expected a recorded plan with slices');
            }
            // Every recorded id stays, so only the replan comparison can tell the gain was forged.
            const forged: QuantizeAction = {
                ...recorded,
                payload: {
                    ...recorded.payload,
                    plan: {
                        ...plan,
                        replacement: {
                            ...plan.replacement,
                            clips: [head, { ...firstSlice, gain: 8 }, ...laterSlices],
                        },
                    },
                },
            };
            const handler = getExecutableCommandRegistrations().find(
                (registration) => registration.actionType === 'quantizeTransients'
            )?.handler;
            const context = { actions: [forged], actionIndex: 0 };
            expect(handler?.validationRefusalReason?.(structuredClone(forged), context)).toContain('no longer matches');

            await expect(executeAppAction(structuredClone(forged))).rejects.toThrow('no longer matches');

            expect(trackClips()).toEqual(before);
            expect(undoStore.value?.past ?? []).toHaveLength(0);
        });

        function seedTakeLane(): void {
            trackStore.set({
                ...trackStore.value!,
                tracks: trackStore.value!.tracks.map((track) => ({
                    ...track,
                    clips: [...track.clips, loopClip({ id: 'clip-take', name: 'Take' })],
                })),
            });
            takeLaneStore.set({
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: TRACK_ID,
                        activeCompRegions: [],
                        takes: [
                            {
                                id: 'take-1',
                                clipId: 'clip-take',
                                name: 'Take 1',
                                selected: false,
                                startBeat: 0,
                                endBeat: 8,
                            },
                        ],
                    },
                ],
            });
            flushAutomergeStorageWrites();
        }

        const compOverClip: AppAction = {
            type: 'setCompRegion',
            payload: { trackId: TRACK_ID, startBeat: 2, endBeat: 4, takeId: 'take-1' },
        };

        it('refuses to cut a clip a comp region earlier in the same batch covers, and writes nothing', async () => {
            seedProject(loopClip());
            seedTakeLane();
            const before = trackClips();
            const lanesBefore = structuredClone(takeLaneStore.value);

            const result = await executeAppActionBatch([
                compOverClip,
                { type: 'quantizeTransients', payload: { clipId: CLIP_ID, gridSize: 1 } },
            ]);

            expect(result.status).toBe('conflicted');
            expect(trackClips()).toEqual(before);
            expect(takeLaneStore.value).toEqual(lanesBefore);
        });

        it('refuses a carried plan once a comp region covers its clip, and writes nothing', async () => {
            seedProject(loopClip());
            seedTakeLane();
            await quantizeTransients(CLIP_ID, 1);
            const recorded = committedQuantize();
            await undo();

            await executeAppAction(structuredClone(compOverClip));
            const comped = trackClips();
            expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toHaveLength(1);

            await expect(executeAppAction(structuredClone(recorded))).rejects.toThrow('no longer matches');
            expect(trackClips()).toEqual(comped);
        });

        it('reports a refusal to the musician instead of rejecting the dispatch', async () => {
            seedProject(loopClip({ locked: true }));
            const notifications: NotifyPayload[] = [];
            const bus = createEventBus<NotificationEvents>();
            bus.on('ui.notify', (payload) => notifications.push(payload));
            setNotificationEventBus(bus);

            await quantizeTransients(CLIP_ID, 1);

            expect(notifications).toHaveLength(1);
            expect(trackClips()).toEqual([loopClip({ locked: true })]);
        });
    });

    it('keeps the gain envelope on the audio each slice plays', async () => {
        seedProject(loopClip());
        gainEnvelopeStore.set({
            envelopes: {
                [CLIP_ID]: {
                    clipId: CLIP_ID,
                    enabled: true,
                    points: [{ id: 'point-1', beatOffset: 3, gainDb: -6 }],
                },
            },
        });
        flushAutomergeStorageWrites();

        await quantizeTransients(CLIP_ID, 1);

        const move = committedMoves().moves[1]!;
        const envelope = gainEnvelopeStore.value?.envelopes[move.sliceClipId];
        expect(envelope?.points).toEqual([{ id: 'point-1', beatOffset: 3 - move.fromBeat, gainDb: -6 }]);
    });

    it('moves clip automation with the slice whose audio it was drawn over, and undo puts it back', async () => {
        seedProject(loopClip());
        const lane = {
            id: 'lane-gain',
            trackId: TRACK_ID,
            clipId: CLIP_ID,
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [{ id: 'point-late', beat: 6.5, value: 0.8, curve: 'linear' as const, tension: 0 }],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        };
        automationStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await quantizeTransients(CLIP_ID, 1);

        // The point sits over the hit heard at 6.3, which moved to 6: it moves with that slice.
        const move = committedMoves().moves[3]!;
        const lanes = automationStore.value?.lanes ?? [];
        expect(lanes).toHaveLength(1);
        expect(lanes[0]).toMatchObject({ clipId: move.sliceClipId, parameterId: 'gain' });
        expect(lanes[0]!.id).not.toBe('lane-gain');
        expect(lanes[0]!.points).toEqual([{ ...lane.points[0], beat: 6.5 + move.toBeat - move.fromBeat }]);

        await undo();
        expect(automationStore.value?.lanes).toEqual([lane]);
    });
});
