/**
 * The loudness-matched A/B over one committed agent action group.
 *
 * The doubles are the four things the comparison actually reads and writes:
 * Command's revert and redo, the undo stacks they move the group through, the
 * transport's play state, and the master trim. Each case names, above itself,
 * the single mutation that turns it red.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentChangeComparisonStore, beginAgentChangeComparison } from '../../stores/agentChangeComparisonStore';
import { type AiActionGroup } from '../../stores/aiActionHistoryStore';
import { agentChangeComparison, getAgentChangeComparisonView } from '../agentChangeComparison';

const GROUP_ID = 'g1';

type UndoEntryDouble = { id: string; groupId?: string };
type UndoStateDouble = { past: UndoEntryDouble[]; future: UndoEntryDouble[] };
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

    /**
     * Stands in for AudioEngine's `ShortTermLUFS`: a three-second window of
     * 400 ms blocks whose reading is their energy mean, floored at -70.
     * Restated here because a spec must not deep-import a foreign module's
     * internals, and the barrel it lives behind is the one this file replaces.
     */
    class ShortTermLUFSDouble {
        private readonly blocks: number[] = [];

        push(momentaryLUFS: number): void {
            this.blocks.push(momentaryLUFS);
            if (this.blocks.length > 8) {
                this.blocks.shift();
            }
        }

        get value(): number {
            if (this.blocks.length === 0) {
                return -70;
            }
            let sum = 0;
            for (const block of this.blocks) {
                sum += 10 ** (block / 10);
            }
            return Math.max(-70, 10 * Math.log10(sum / this.blocks.length));
        }
    }

    return {
        ShortTermLUFSDouble,
        undoHistoryStore: createTestStore<UndoStateDouble>({ past: [], future: [] }),
        transportStore: createTestStore<TransportStateDouble>({ isPlaying: true }),
        aiActionHistoryStore: createTestStore<HistoryStateDouble>({ groups: [], panelOpen: false }),
    };
});

const mocks = vi.hoisted(() => ({
    setMasterComparisonTrimDb: vi.fn<(db: number) => { appliedDb: number; limited: boolean }>(),
    hasLiveNativeGraphSession: vi.fn<() => boolean>(),
    computeMomentaryLUFS: vi.fn<() => number>(),
    revertActionGroup: vi.fn<(groupId: string) => Promise<void>>(),
    redo: vi.fn<() => Promise<void>>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    computeMomentaryLUFS: mocks.computeMomentaryLUFS,
    getAudioSampleRate: () => 48000,
    getMasterAnalyser: () => ({ frequencyBinCount: 4, getFloatTimeDomainData: () => undefined }),
    hasLiveNativeGraphSession: mocks.hasLiveNativeGraphSession,
    setMasterComparisonTrimDb: mocks.setMasterComparisonTrimDb,
    ShortTermLUFS: doubles.ShortTermLUFSDouble,
}));

vi.mock('#/modules/Command/stores', () => ({ undoHistoryStore: doubles.undoHistoryStore }));

vi.mock('#/modules/Command/useCases', () => ({
    redo: mocks.redo,
    revertActionGroup: mocks.revertActionGroup,
}));

vi.mock('#/modules/Transport/stores', () => ({ transportStore: doubles.transportStore }));

vi.mock('#/modules/AiRuntime/stores/aiActionHistoryStore', () => ({
    aiActionHistoryStore: doubles.aiActionHistoryStore,
}));

function makeGroup(overrides: Partial<AiActionGroup> = {}): AiActionGroup {
    return {
        id: 'a1',
        prompt: 'add a plate on the vocal',
        actions: [],
        groupId: GROUP_ID,
        timestamp: 0,
        reverted: false,
        executionKind: 'project',
        ...overrides,
    };
}

/** The group standing as the newest undoable unit — the only shape a comparison may open on. */
function committed(): UndoStateDouble {
    return { past: [{ id: 'e1', groupId: GROUP_ID }], future: [] };
}

/** The group standing as the next redoable unit, which is where a revert leaves it. */
function reverted(): UndoStateDouble {
    return { past: [], future: [{ id: 'e1', groupId: GROUP_ID }] };
}

/**
 * Ticks that carry one side to a trusted reading: eight 400 ms blocks, each of
 * them four 100 ms sampler intervals.
 */
const TICKS_PER_TRUSTED_READING = 32;

/** Run `ticks` sampler intervals with the master tap reading `lufs`. */
function sample(lufs: number, ticks: number): void {
    mocks.computeMomentaryLUFS.mockReturnValue(lufs);
    vi.advanceTimersByTime(ticks * 100);
}

function trimCalls(): number[] {
    return mocks.setMasterComparisonTrimDb.mock.calls.map(([db]) => db);
}

/** A second group standing where a comparison could open on it. */
function admitSecondGroup(): void {
    doubles.aiActionHistoryStore.set({
        groups: [makeGroup(), makeGroup({ id: 'a2', groupId: 'g2' })],
        panelOpen: false,
    });
    doubles.undoHistoryStore.set({ past: [{ id: 'e2', groupId: 'g2' }], future: [] });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.setMasterComparisonTrimDb.mockReturnValue({ appliedDb: 0, limited: false });
    mocks.hasLiveNativeGraphSession.mockReturnValue(false);
    mocks.computeMomentaryLUFS.mockReturnValue(-70);
    // The doubles move the stacks the way Command's own revert and redo do, so
    // the divergence watch sees what it would see in the app.
    mocks.revertActionGroup.mockImplementation(async () => {
        doubles.undoHistoryStore.set(reverted());
    });
    mocks.redo.mockImplementation(async () => {
        doubles.undoHistoryStore.set(committed());
    });
    doubles.undoHistoryStore.set(committed());
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

describe('agentChangeComparison.availability', () => {
    // T1. Turns red if the newest-undoable check is dropped: `later-edits`
    // would never be reachable and this would report the group unavailable.
    it('admits the newest committed project group', () => {
        expect(agentChangeComparison.availability({ groupId: GROUP_ID })).toEqual({ available: true });
    });

    // T1. Turns red if `pastEndsWithGroup` compares against any entry rather
    // than the last one: this would report `{ available: true }`.
    it('refuses a group that later edits have buried', () => {
        doubles.undoHistoryStore.set({ past: [{ id: 'e1', groupId: GROUP_ID }, { id: 'e2' }], future: [] });

        expect(agentChangeComparison.availability({ groupId: GROUP_ID })).toEqual({
            available: false,
            reason: 'later-edits',
        });
    });

    // T1. Turns red if the `executionKind` guard is dropped: a runtime receipt
    // owns no undo entries, so this would report it available.
    it('refuses a runtime execution receipt', () => {
        doubles.aiActionHistoryStore.set({ groups: [makeGroup({ executionKind: 'runtime' })], panelOpen: false });

        expect(agentChangeComparison.availability({ groupId: GROUP_ID })).toEqual({
            available: false,
            reason: 'runtime-group',
        });
    });

    // T1. Turns red if the `reverted` guard is dropped: this would report
    // available for a group whose change is already gone.
    it('refuses a group the musician already reverted', () => {
        doubles.aiActionHistoryStore.set({ groups: [makeGroup({ reverted: true })], panelOpen: false });

        expect(agentChangeComparison.availability({ groupId: GROUP_ID })).toEqual({
            available: false,
            reason: 'reverted',
        });
    });

    // T1. Turns red if the active-session guard compares nothing, or compares
    // the wrong id: this would report the second group available while the
    // first one still owns the trim.
    it('refuses a second group while another comparison is running', () => {
        doubles.aiActionHistoryStore.set({
            groups: [makeGroup(), makeGroup({ id: 'a2', groupId: 'g2' })],
            panelOpen: false,
        });
        beginAgentChangeComparison({ groupId: GROUP_ID, measurement: 'web-master' });
        doubles.undoHistoryStore.set({ past: [{ id: 'e2', groupId: 'g2' }], future: [] });

        expect(agentChangeComparison.availability({ groupId: 'g2' })).toEqual({
            available: false,
            reason: 'another-comparison-active',
        });
    });

    // T1. Turns red if the group lookup keys off `id` rather than `groupId`.
    it('refuses a group the history does not hold', () => {
        expect(agentChangeComparison.availability({ groupId: 'missing' })).toEqual({
            available: false,
            reason: 'group-not-found',
        });
    });
});

describe('agentChangeComparison.toggle', () => {
    // T2. Turns red if the B side reverts more than the group, or if
    // `settleOnSide` reports the side it came from: the call count or the
    // reported side changes.
    it('reverts the group once to reach side A and redoes it once to return to B', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });

        await expect(agentChangeComparison.toggle()).resolves.toEqual({ status: 'A' });
        expect(mocks.revertActionGroup.mock.calls).toEqual([[GROUP_ID]]);

        await expect(agentChangeComparison.toggle()).resolves.toEqual({ status: 'B' });
        expect(mocks.redo).toHaveBeenCalledTimes(1);
    });

    // T2. Turns red if `transitioning` is marked inside the queued work rather
    // than before it: the second press would queue behind the revert and
    // resolve to `{ status: 'B' }` instead of refusing.
    it('refuses a second press while the revert is still in flight', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });

        let releaseRevert = (): void => undefined;
        mocks.revertActionGroup.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseRevert = () => {
                        doubles.undoHistoryStore.set(reverted());
                        resolve();
                    };
                })
        );

        const first = agentChangeComparison.toggle();
        const second = await agentChangeComparison.toggle();
        expect(second).toEqual({ status: 'refused', reason: 'transitioning' });

        releaseRevert();
        await expect(first).resolves.toEqual({ status: 'A' });
    });

    // T11. Turns red if the queued work moves the project on the session the
    // press captured rather than on the one standing when it runs: the revert
    // would land on a comparison the ending in front of it had already closed,
    // leaving the project on side A with nothing to bring it back.
    it('refuses a press that lands behind the ending it raced', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });

        const ending = agentChangeComparison.end();
        const pressed = agentChangeComparison.toggle();
        await ending;

        await expect(pressed).resolves.toEqual({ status: 'refused', reason: 'inactive' });
        expect(mocks.revertActionGroup).not.toHaveBeenCalled();
    });

    // T12. Turns red if a rejected revert is left to propagate: the press would
    // reject, and the comparison would stand with `transitioning` set, its trim
    // on the output and no press able to move it.
    it('closes the comparison when the revert to side A rejects', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        mocks.revertActionGroup.mockRejectedValueOnce(new Error('the revert could not be applied'));

        await expect(agentChangeComparison.toggle()).resolves.toEqual({ status: 'refused', reason: 'inactive' });

        const view = getAgentChangeComparisonView();
        expect(trimCalls().at(-1)).toBe(0);
        expect(view.active).toBeNull();
        expect(view.lastEnded).toEqual({ groupId: GROUP_ID, side: 'B', reason: 'transition-failed' });
        admitSecondGroup();
        expect(agentChangeComparison.availability({ groupId: 'g2' })).toEqual({ available: true });
    });

    // T12. The same on the way back, where the move is a redo.
    it('closes the comparison when the redo back to side B rejects', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        await agentChangeComparison.toggle();
        mocks.redo.mockRejectedValueOnce(new Error('the redo could not be applied'));
        mocks.setMasterComparisonTrimDb.mockClear();

        await expect(agentChangeComparison.toggle()).resolves.toEqual({ status: 'refused', reason: 'inactive' });

        const view = getAgentChangeComparisonView();
        expect(trimCalls().at(-1)).toBe(0);
        expect(view.active).toBeNull();
        expect(view.lastEnded).toEqual({ groupId: GROUP_ID, side: 'A', reason: 'transition-failed' });
        admitSecondGroup();
        expect(agentChangeComparison.availability({ groupId: 'g2' })).toEqual({ available: true });
    });
});

describe('agentChangeComparison loudness match', () => {
    // T3. Turns red if `matchDb` is computed as `a - b`, or if the per-side
    // meter is not reset on a side change: the trim would be asked for -6, or
    // for the average of both sides.
    it('offsets side A by the difference between the two sides', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        sample(-14, TICKS_PER_TRUSTED_READING);

        await agentChangeComparison.toggle();
        sample(-20, TICKS_PER_TRUSTED_READING);

        const view = getAgentChangeComparisonView();
        expect(view.active?.loudness.b).toBeCloseTo(-14, 6);
        expect(view.active?.loudness.a).toBeCloseTo(-20, 6);
        expect(view.active?.matchDb).toBeCloseTo(6, 6);
        expect(trimCalls().at(-1)).toBeCloseTo(6, 6);

        await agentChangeComparison.toggle();
        expect(trimCalls().at(-1)).toBe(0);
    });

    // T10. Turns red if the readings reach the accumulator at the 100 ms tick
    // rate: its eight 400 ms blocks would then hold the last 800 ms of the side
    // rather than its three seconds, and the quiet opening would be recorded as
    // the loud ending — -10 instead of the mean of what the side played.
    it('reads a side over its whole window rather than over its tail', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });

        // Six blocks at -30 then two at -10: energy mean 10 * log10(0.206 / 8).
        sample(-30, 24);
        sample(-10, 8);

        expect(getAgentChangeComparisonView().active?.loudness.b).toBeCloseTo(-15.89, 2);
    });

    // T4. Turns red if the trim's `limited` answer is discarded: the view would
    // claim a match the fader ceiling never delivered.
    it('reports a match the fader had no headroom to deliver', async () => {
        mocks.setMasterComparisonTrimDb.mockReturnValue({ appliedDb: 2, limited: true });
        await agentChangeComparison.start({ groupId: GROUP_ID });

        await agentChangeComparison.toggle();

        expect(getAgentChangeComparisonView().active?.matchLimited).toBe(true);
    });

    // T7. Turns red if the sampler pushes without checking the measurement: the
    // stopped transport's silence would be recorded as side B's loudness.
    it('measures nothing while the transport is stopped and resumes when it rolls', async () => {
        doubles.transportStore.set({ isPlaying: false });
        await agentChangeComparison.start({ groupId: GROUP_ID });

        sample(-14, TICKS_PER_TRUSTED_READING);
        expect(getAgentChangeComparisonView().active?.measurement).toBe('unavailable-not-playing');
        expect(getAgentChangeComparisonView().active?.loudness.b).toBeNull();

        doubles.transportStore.set({ isPlaying: true });
        sample(-14, TICKS_PER_TRUSTED_READING);

        expect(getAgentChangeComparisonView().active?.measurement).toBe('web-master');
        expect(getAgentChangeComparisonView().active?.loudness.b).toBeCloseTo(-14, 6);
    });

    // T8. Turns red if the native-carrier check is dropped: the Web Audio tap
    // hears none of a natively carried mix, so it would match the two sides on
    // a reading of silence and put a bogus offset on the output.
    it('declines to measure a mix a native session is carrying', async () => {
        mocks.hasLiveNativeGraphSession.mockReturnValue(true);
        await agentChangeComparison.start({ groupId: GROUP_ID });

        sample(-14, TICKS_PER_TRUSTED_READING);
        await agentChangeComparison.toggle();
        sample(-20, TICKS_PER_TRUSTED_READING);

        const view = getAgentChangeComparisonView();
        expect(view.active?.measurement).toBe('unavailable-native-carrier');
        expect(view.active?.matchDb).toBeNull();
        expect(trimCalls().every((db) => db === 0)).toBe(true);
    });
});

describe('agentChangeComparison ending', () => {
    // T5. Turns red if the divergence watch does not end the comparison, or
    // ends it by redoing: `active` would survive, or `redo` would be called
    // over an edit that already took the group's place.
    it('ends without redoing when another edit takes the group position', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        await agentChangeComparison.toggle();
        mocks.redo.mockClear();
        mocks.setMasterComparisonTrimDb.mockClear();

        doubles.undoHistoryStore.set({ past: [], future: [{ id: 'other' }] });

        const view = getAgentChangeComparisonView();
        expect(view.active).toBeNull();
        expect(view.lastEnded).toEqual({ groupId: GROUP_ID, side: 'A', reason: 'project-changed' });
        expect(trimCalls()).toEqual([0]);
        expect(mocks.redo).not.toHaveBeenCalled();
    });

    // T6. Turns red if `end` leaves side A standing: the project would keep the
    // group reverted after a comparison the musician only wanted to hear.
    it('returns the committed project when the musician ends on side A', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        await agentChangeComparison.toggle();
        mocks.redo.mockClear();
        mocks.setMasterComparisonTrimDb.mockClear();

        await agentChangeComparison.end();

        expect(mocks.redo).toHaveBeenCalledTimes(1);
        expect(trimCalls()).toEqual([0]);
        const view = getAgentChangeComparisonView();
        expect(view.active).toBeNull();
        expect(view.lastEnded).toEqual({ groupId: GROUP_ID, side: 'A', reason: 'user-ended' });
    });

    // T12. Turns red if a rejected redo is left to propagate out of the ending:
    // the comparison would stand with its trim on the output after the musician
    // closed it.
    it('closes the comparison when the redo the ending runs rejects', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        await agentChangeComparison.toggle();
        mocks.redo.mockRejectedValueOnce(new Error('the redo could not be applied'));
        mocks.setMasterComparisonTrimDb.mockClear();

        await expect(agentChangeComparison.end()).resolves.toBeUndefined();

        const view = getAgentChangeComparisonView();
        expect(trimCalls()).toEqual([0]);
        expect(view.active).toBeNull();
        expect(view.lastEnded).toEqual({ groupId: GROUP_ID, side: 'A', reason: 'transition-failed' });
        admitSecondGroup();
        expect(agentChangeComparison.availability({ groupId: 'g2' })).toEqual({ available: true });
    });

    // T13. Turns red if the ending reports `user-ended` without checking what
    // the redo landed on: the comparison would read as a return to the
    // committed project while side A is what the musician is still hearing.
    it('says the ending left side A standing when the redo did not return the group', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });
        await agentChangeComparison.toggle();
        mocks.setMasterComparisonTrimDb.mockClear();
        // Answers without moving the stacks, so the group is still the next
        // redoable unit and the project is still the one side A was left on.
        mocks.redo.mockImplementation(async () => undefined);

        await agentChangeComparison.end();

        const view = getAgentChangeComparisonView();
        expect(view.lastEnded).toEqual({ groupId: GROUP_ID, side: 'A', reason: 'left-on-a' });
        expect(trimCalls()).toEqual([0]);
    });

    // T9. Turns red if the history watch is not subscribed: the comparison
    // would keep offsetting a side the Revert control has already removed.
    it('ends when the group is reverted from the history panel', async () => {
        await agentChangeComparison.start({ groupId: GROUP_ID });

        doubles.aiActionHistoryStore.set({ groups: [makeGroup({ reverted: true })], panelOpen: false });

        const view = getAgentChangeComparisonView();
        expect(view.active).toBeNull();
        expect(view.lastEnded).toEqual({ groupId: GROUP_ID, side: 'B', reason: 'group-reverted' });
    });
});
