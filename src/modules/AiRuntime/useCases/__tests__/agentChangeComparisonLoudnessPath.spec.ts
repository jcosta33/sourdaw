/**
 * The comparison's loudness reads the same BS.1770-4 K-weighted path the master
 * LUFS meter reads: this spec leaves the real `MomentaryLUFS` and
 * `ShortTermLUFS` in the barrel (only the engine taps and the cross-module
 * stores are doubles) and plays the EBU R128 reference tone — 48 kHz, 1 kHz,
 * -23 dBFS on both channels — into a running comparison. The reading must land
 * on -23.0 LUFS; the one-pole path this replaces measured the same tone at
 * -41.96.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentChangeComparisonStore } from '../../stores/agentChangeComparisonStore';
import { type AiActionGroup } from '../../stores/aiActionHistoryStore';
import { agentChangeComparison, getAgentChangeComparisonView } from '../agentChangeComparison';

const GROUP_ID = 'g1';

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

/** Peak amplitude of the reference tone, and the tap's phase advance through it. */
const tap = { amplitude: 10 ** (-23 / 20), phase: 0 };

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    // The real barrel: the comparison must read the production MomentaryLUFS
    // and ShortTermLUFS for this spec to say anything. Only the engine access
    // is replaced — a reference-tone tap standing in for the analysers.
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();

    const referenceToneAnalyser = (advancesPhase: boolean) => ({
        fftSize: 256,
        getFloatTimeDomainData: (arr: Float32Array) => {
            for (let index = 0; index < arr.length; index++) {
                arr[index] = tap.amplitude * Math.sin((2 * Math.PI * 1000 * (tap.phase + index)) / 48000);
            }
            // Both channels must carry the same segment, so only the second
            // read (the sampler reads left, then right) advances the tone.
            if (advancesPhase) {
                tap.phase += arr.length;
            }
        },
    });

    return {
        ...actual,
        getAudioSampleRate: () => 48000,
        getMasterStereoAnalysers: () => ({
            left: referenceToneAnalyser(false),
            right: referenceToneAnalyser(true),
        }),
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

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.setMasterComparisonTrimDb.mockReturnValue({ appliedDb: 0, limited: false });
    mocks.hasLiveNativeGraphSession.mockReturnValue(false);
    tap.phase = 0;
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

describe('agentChangeComparison loudness path', () => {
    it('records the reference tone at -23.0 LUFS through the real K-weighted metering', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });

        // 75 ticks fill the 400 ms momentary window (256 samples per tick at
        // 48 kHz); eight 400 ms blocks of four ticks each then cover the
        // three-second short-term window and record the side.
        vi.advanceTimersByTime(120 * 100);

        const view = getAgentChangeComparisonView();
        expect(view.active?.measurement).toBe('web-master');
        expect(view.active?.loudness.b).toBeCloseTo(-23, 1);
        expect(view.active?.matchDb).toBeNull();
    });
});
