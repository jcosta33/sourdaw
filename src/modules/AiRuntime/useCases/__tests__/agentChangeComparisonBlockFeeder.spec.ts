/**
 * The comparison's block feeder must retain whatever a tap read straddles past
 * a block boundary: a read that crosses the 19,200-frame line leaves the next
 * block's head held, and losing that retention pushes already-heard samples to
 * the meter again while fresh programme waits past the release window. Every
 * other comparison spec reads 256-sample ticks at 48 kHz, and 19,200 divides
 * by 256, so no remainder ever forms there — this spec drives a read cadence
 * whose chunks straddle the boundaries.
 *
 * `MomentaryLUFS` is doubled in the barrel to capture the exact frames the
 * feeder releases; everything else the comparison reads stays real. The
 * programme encodes each sample's stream position in its value, so a
 * duplicated, dropped, or reordered sample breaks equality rather than only
 * the block counts (a periodic tone would alias).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentChangeComparisonStore } from '../../stores/agentChangeComparisonStore';
import { type AiActionGroup } from '../../stores/aiActionHistoryStore';
import { agentChangeComparison, getAgentChangeComparisonView } from '../agentChangeComparison';

const GROUP_ID = 'g1';

/** BS.1770-4 momentary block at the spec's 48 kHz: 0.4 s of frames. */
const BLOCK_FRAMES = 19_200;

type UndoStateDouble = { past: { id: string; groupId?: string }[]; future: { id: string; groupId?: string }[] };
type TransportStateDouble = { isPlaying: boolean };
type HistoryStateDouble = { groups: AiActionGroup[]; panelOpen: boolean };

const doubles = vi.hoisted(() => {
    const createTestStore = <TValue>(initial: TValue) => {
        let current = initial;
        const listeners = new Set<(value: TValue) => void>();
        return {
            get value(): TValue {
                return current;
            },
            set(next: TValue): void {
                current = next;
                for (const listener of [...listeners]) {
                    listener(next);
                }
            },
            subscribe(listener: (value: TValue) => void): () => void {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
        };
    };

    return {
        undoHistoryStore: createTestStore<UndoStateDouble>({ past: [], future: [] }),
        transportStore: createTestStore<TransportStateDouble>({ isPlaying: true }),
        aiActionHistoryStore: createTestStore<HistoryStateDouble>({ groups: [], panelOpen: false }),
    };
});

const mocks = vi.hoisted(() => ({
    setMasterComparisonTrimDb: vi.fn<(db: number) => { appliedDb: number; limited: boolean }>(),
    hasLiveNativeGraphSession: vi.fn<() => boolean>(),
}));

const harness = vi.hoisted(() => {
    /** Programme samples: each value is its stream position, never repeating. */
    const leftSampleAt = (index: number): number => (index + 1) / 1_000_000;
    const rightSampleAt = (index: number): number => -(index + 1) / 1_000_000;

    const cursors = { left: 0, right: 0 };

    const tapAnalyser = (channel: 'left' | 'right') => ({
        fftSize: 256,
        getFloatTimeDomainData: (arr: Float32Array): void => {
            const sampleAt = channel === 'left' ? leftSampleAt : rightSampleAt;
            for (let index = 0; index < arr.length; index += 1) {
                arr[index] = sampleAt(cursors[channel] + index);
            }
            cursors[channel] += arr.length;
        },
    });

    const pushes: { left: Float32Array; right: Float32Array }[] = [];

    /** Stands in for the real meter at the barrel so released frames are observable. */
    class CapturingMomentaryLUFS {
        // The comparison reads the same constructor shape as the real class.
        constructor(_sampleRate: number) {}
        push(left: Float32Array, right: Float32Array): void {
            // The feeder reuses its pending buffer across releases, so capture copies.
            pushes.push({ left: Float32Array.from(left), right: Float32Array.from(right) });
        }
        get filled(): boolean {
            return true;
        }
        get energy(): number {
            return 0;
        }
        get value(): number {
            return -70;
        }
    }

    return {
        leftSampleAt,
        rightSampleAt,
        cursors,
        leftAnalyser: tapAnalyser('left'),
        rightAnalyser: tapAnalyser('right'),
        pushes,
        CapturingMomentaryLUFS,
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    // The real barrel with one swap: `MomentaryLUFS` is the capture double so
    // the exact frames the feeder releases are observable at the meter
    // boundary. The comparison's engine access is replaced with the scripted tap.
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        MomentaryLUFS: harness.CapturingMomentaryLUFS,
        getAudioSampleRate: () => 48_000,
        getMasterStereoAnalysers: () => ({ left: harness.leftAnalyser, right: harness.rightAnalyser }),
        hasLiveNativeGraphSession: mocks.hasLiveNativeGraphSession,
        setMasterComparisonTrimDb: mocks.setMasterComparisonTrimDb,
    };
});

vi.mock('#/modules/Command/stores', () => ({ undoHistoryStore: doubles.undoHistoryStore }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    // Spread: the real AudioEngine barrel this file loads reaches Command's
    // other consumers, so the factory must carry the barrel's whole surface.
    // The comparison's own moves are replaced with controllable doubles.
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    redo: vi.fn<() => Promise<void>>(),
    revertActionGroup: vi.fn<(groupId: string) => Promise<void>>(),
}));
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: doubles.transportStore,
}));
vi.mock('#/modules/AiRuntime/stores/aiActionHistoryStore', () => ({
    aiActionHistoryStore: doubles.aiActionHistoryStore,
}));

function makeGroup(): AiActionGroup {
    return {
        id: 'a1',
        prompt: 'add a plate on the vocal',
        actions: [],
        groupId: GROUP_ID,
        timestamp: 0,
        reverted: false,
        executionKind: 'project',
    };
}

/** One tick of the shipped 10 Hz sampler, reading `samples` frames from the tap. */
const runTick = (samples: number): void => {
    harness.leftAnalyser.fftSize = samples;
    harness.rightAnalyser.fftSize = samples;
    vi.advanceTimersByTime(100);
};

const repeat = (samples: number, times: number): number[] => Array.from({ length: times }, () => samples);

/**
 * Read sizes whose running total straddles every 19,200-frame boundary: three
 * blocks released, 9,750 frames held after the cadence, and single chunks
 * (32,768) long enough to hold more than one whole block.
 */
const boundaryStraddlingReads = [
    ...repeat(256, 3),
    333,
    7_000,
    ...repeat(256, 10),
    32_768,
    1,
    5_000,
    17_640,
    ...repeat(256, 5),
];

/** The programme as it should have reached the meter, sample by sample. */
const expectedStream = (sampleAt: (index: number) => number, from: number, to: number): Float32Array => {
    const stream = new Float32Array(to - from);
    for (let index = 0; index < stream.length; index += 1) {
        stream[index] = sampleAt(from + index);
    }
    return stream;
};

/** The exact samples the meter received across the given pushes, in order. */
const receivedStream = (channel: 'left' | 'right', fromPush: number, toPush: number): Float32Array => {
    const frames = harness.pushes.slice(fromPush, toPush).map((push) => push[channel]);
    const stream = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0));
    let offset = 0;
    for (const frame of frames) {
        stream.set(frame, offset);
        offset += frame.length;
    }
    return stream;
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.setMasterComparisonTrimDb.mockReturnValue({ appliedDb: 0, limited: false });
    mocks.hasLiveNativeGraphSession.mockReturnValue(false);
    harness.cursors.left = 0;
    harness.cursors.right = 0;
    harness.pushes.length = 0;
    doubles.undoHistoryStore.set({ past: [{ id: 'e1', groupId: GROUP_ID }], future: [] });
    doubles.transportStore.set({ isPlaying: true });
    doubles.aiActionHistoryStore.set({ groups: [makeGroup()], panelOpen: false });
    agentChangeComparisonStore.set({ active: null, lastEnded: null });
});

afterEach(async () => {
    // Module state, process-wide by design: a leaked sampler would keep ticking
    // into the next case's stores.
    await agentChangeComparison.end();
    vi.useRealTimers();
});

describe('agentChangeComparison momentary block feeder', () => {
    it('releases whole blocks with the boundary remainder retained, every sample exactly once in order', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        expect(getAgentChangeComparisonView().active?.measurement).toBe('web-master');

        for (const samples of boundaryStraddlingReads) {
            runTick(samples);
        }

        expect(harness.pushes).toHaveLength(3);
        for (const push of harness.pushes) {
            expect(push.left).toHaveLength(BLOCK_FRAMES);
            expect(push.right).toHaveLength(BLOCK_FRAMES);
        }
        expect(receivedStream('left', 0, 3)).toEqual(expectedStream(harness.leftSampleAt, 0, 3 * BLOCK_FRAMES));
        expect(receivedStream('right', 0, 3)).toEqual(expectedStream(harness.rightSampleAt, 0, 3 * BLOCK_FRAMES));

        // The 9,750 held frames are the fourth block's head: feeding the
        // block's remaining 9,450 releases them first, in order, ahead of the
        // fresh read.
        runTick(BLOCK_FRAMES - 9_750);
        expect(harness.pushes).toHaveLength(4);
        expect(receivedStream('left', 3, 4)).toEqual(
            expectedStream(harness.leftSampleAt, 3 * BLOCK_FRAMES, 4 * BLOCK_FRAMES)
        );
        expect(receivedStream('right', 3, 4)).toEqual(
            expectedStream(harness.rightSampleAt, 3 * BLOCK_FRAMES, 4 * BLOCK_FRAMES)
        );

        // Frames short of a block stay held; nothing partial reaches the meter.
        runTick(256);
        runTick(256);
        expect(harness.pushes).toHaveLength(4);
        const consumed = 67_350 + 9_450 + 512;
        expect(harness.cursors).toEqual({ left: consumed, right: consumed });
    });
});
