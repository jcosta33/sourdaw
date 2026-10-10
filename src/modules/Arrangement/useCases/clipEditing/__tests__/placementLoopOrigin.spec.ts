import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { defaultTransportState, playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { isBeatInClipLoopWindow, resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';

import { type Clip, createTrack } from '../../../models/Track';
import { clipboardStore } from '../../../stores/clipboardStore';
import { defaultTrackState, trackStore } from '../../../stores/trackStore';
import { duplicateClipCore } from '../../clip/duplicateClipCore';
import { moveClip } from '../../clip/moveClip';
import { copySelectedClip } from '../../clipboard/copySelectedClip';
import { pasteClip } from '../../clipboard/pasteClip';
import { selectClip } from '../../clipSelection/selectClip';
import { planRippleDelete } from '../../rippleDelete/planRippleDelete';
import { rippleDeleteClips } from '../../rippleDelete/rippleDeleteClips';
import { undoRippleDelete } from '../../rippleDelete/undoRippleDelete';
import { rippleInsertClip } from '../../rippleInsert/rippleInsertClip';
import { undoRippleInsertClip } from '../../rippleInsert/undoRippleInsertClip';
import { rippleMoveClip } from '../../rippleMove/rippleMoveClip';
import { deleteTime } from '../../timeOperations/deleteTime';
import { duplicateTimeRange } from '../../timeOperations/duplicateTimeRange';
import { insertTime } from '../../timeOperations/insertTime';
import { setTimeOperationDependencies } from '../../timeOperations/timeOperationDependencies';
import { nudgeClip } from '../nudgeClip';

/**
 * #4988, the placement half of the anchor's write law. A start trim advances
 * the content offset and keeps the anchor (`trimClipStartLoopOrigin.spec.ts`);
 * every writer that relocates a clip WITHOUT touching its content offset — a
 * drag, a nudge, a ripple shift, a global time operation, a duplicate or a
 * paste placed elsewhere — must move the anchor by the same delta. The
 * advance `startBeat - loopOriginBeat` is the one number the loop window, the
 * per-pass occurrence count and the playback projection all derive from, so
 * each case pins the persisted anchor and asserts the probe (advance, window
 * membership, two-pass projection) is unchanged across the write. A writer
 * that spread `...clip` over a rewritten `startBeat` — the pre-fix state —
 * fails all three at once: dragging by exactly one loop length derives an
 * advance equal to the loop length, whose window admits nothing and silences
 * the clip.
 */

const LOOP_LENGTH = 4;

type ProbeEvent = { id: string; startBeat: number; duration: number; velocity: number };

const PROBE_EVENTS: ProbeEvent[] = [
    { id: 'head', startBeat: 0, duration: 0.5, velocity: 80 },
    { id: 'late', startBeat: 4.5, duration: 0.5, velocity: 80 },
];

type AnchorProbe = {
    advance: number;
    /** Membership per probe event, in offset-relative media beats. */
    window: boolean[];
    /** One entry per projected pass (pass 0 and pass 1), `id@clip-relative beat`. */
    projection: string[];
};

function projectPasses(clip: Clip): string[] {
    return [clip.startBeat, clip.startBeat + LOOP_LENGTH].map((iterationStartBeat) =>
        projectClipMidiEvents({
            events: PROBE_EVENTS,
            clipId: clip.id,
            clipStartBeat: clip.startBeat,
            clipEndBeat: clip.endBeat,
            iterationStartBeat,
            loopLengthBeats: clip.loopLength ?? LOOP_LENGTH,
            midiOffsetBeats: clip.midiOffsetBeats ?? 0,
            loopEnabled: clip.loopEnabled ?? false,
            loopOriginBeat: clip.loopOriginBeat,
            clipGrooveAlreadyApplied: true,
        })
            .map((event) => `${event.id}@${event.startBeat - clip.startBeat}`)
            .toSorted()
            .join(',')
    );
}

function probe(clip: Clip): AnchorProbe {
    return {
        advance: resolveClipLoopOriginAdvance({
            startBeat: clip.startBeat,
            loopOriginBeat: clip.loopOriginBeat,
            loopEnabled: clip.loopEnabled ?? false,
        }),
        window: PROBE_EVENTS.map((event) =>
            isBeatInClipLoopWindow({
                relativeBeat: event.startBeat - (clip.midiOffsetBeats ?? 0),
                startBeat: clip.startBeat,
                loopOriginBeat: clip.loopOriginBeat,
                loopLengthBeats: clip.loopLength ?? LOOP_LENGTH,
                loopEnabled: clip.loopEnabled ?? false,
            })
        ),
        projection: projectPasses(clip),
    };
}

function loopedClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c-loop',
        trackId: 't-keys',
        name: 'Loop',
        startBeat: 0,
        endBeat: 16,
        type: 'midi',
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: LOOP_LENGTH,
        loopOriginBeat: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function seedTracks(clips: Clip[]): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: [{ ...createTrack({ id: 't-keys', name: 'Keys', kind: 'midi', withoutDefaultDevice: true }), clips }],
        selectedTrackId: 't-keys',
    });
}

function readClip(clipId: string): Clip {
    const found = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!found) {
        throw new Error(`Expected clip ${clipId} in the track store`);
    }
    return found;
}

describe('placement keeps a looped clip anchored (#4988)', () => {
    let previousPlayhead = 0;

    beforeEach(() => {
        // The global time operations write their clip geometry through the
        // real executor; only the automation/transport/MIDI satellites are
        // stubbed, and the Arrangement handle's own hasChanges still decides
        // `applied` from the clip rewrite this spec asserts on.
        const unchanged = { status: 'ready' as const, hasChanges: false, apply: () => true, revert: () => true };
        setTimeOperationDependencies({
            prepareAutomationTimeOperation: () => ({ ...unchanged, inversePlan: null }),
            prepareAutomationTimeStateRestore: () => unchanged,
            prepareTimelineMapTimeOperation: () => ({ ...unchanged, inversePlan: null }),
            prepareTimelineMapStateRestore: () => unchanged,
            prepareMidiGlobalTimeTransaction: () => ({
                ...unchanged,
                replayPlan: { version: 1, notes: [] },
                inversePlan: null,
            }),
            prepareMidiTimeStateRestore: () => unchanged,
        });
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        transportStore.set(defaultTransportState);
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
        previousPlayhead = playheadPositionRef.current;
        playheadPositionRef.current = 0;
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        playheadPositionRef.current = previousPlayhead;
        trackStore.set(structuredClone(defaultTrackState));
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
    });

    it('moveClip: a drag by exactly one loop length keeps anchor, window, passes and projection', () => {
        seedTracks([loopedClip()]);
        const before = probe(readClip('c-loop'));

        expect(moveClip('c-loop', 't-keys', LOOP_LENGTH)).toBe(true);

        const moved = readClip('c-loop');
        // The stale-anchor failure this pins: an unshifted anchor at 0 under
        // start 4 derives advance = loopLength, whose window admits nothing.
        expect(moved.startBeat).toBe(LOOP_LENGTH);
        expect(moved.loopOriginBeat).toBe(LOOP_LENGTH);
        expect(probe(moved)).toEqual(before);
        expect(probe(moved).window).toEqual([true, false]);
    });

    it('moveClip: a drag by a non-multiple keeps the anchor riding the rectangle', () => {
        seedTracks([loopedClip()]);
        const before = probe(readClip('c-loop'));

        expect(moveClip('c-loop', 't-keys', 2.5)).toBe(true);

        const moved = readClip('c-loop');
        expect(moved.loopOriginBeat).toBe(2.5);
        expect(probe(moved)).toEqual(before);
    });

    it('moveClip: successive hops accumulate the anchor, preserving a trim-earned advance', () => {
        // The clip was trimmed two beats before being moved: the trim earned
        // advance 2 (trim law), and every later drag must carry BOTH numbers.
        seedTracks([loopedClip({ startBeat: 2, loopOriginBeat: 0 })]);
        const before = probe(readClip('c-loop'));
        expect(before.advance).toBe(2);

        expect(moveClip('c-loop', 't-keys', 8)).toBe(true);
        expect(moveClip('c-loop', 't-keys', 9)).toBe(true);

        const moved = readClip('c-loop');
        expect(moved.startBeat).toBe(9);
        expect(moved.loopOriginBeat).toBe(7);
        expect(probe(moved)).toEqual(before);
    });

    it('nudgeClip: the anchor rides the applied (clamped) delta', () => {
        seedTracks([loopedClip({ startBeat: 1, loopOriginBeat: 1 })]);
        const before = probe(readClip('c-loop'));

        expect(nudgeClip('c-loop', 3)).toBe(true);
        expect(readClip('c-loop').startBeat).toBe(4);
        expect(readClip('c-loop').loopOriginBeat).toBe(4);

        // The clamp at zero is what the anchor must follow: a nudge of −5
        // from start 1 lands at 0, so the anchor moves by −1, not by −5.
        expect(nudgeClip('c-loop', -5)).toBe(true);
        const clamped = readClip('c-loop');
        expect(clamped.startBeat).toBe(0);
        expect(clamped.loopOriginBeat).toBe(0);
        expect(probe(clamped)).toEqual(before);
    });

    it('duplicateClipCore: the copy carries the source anchor at the copy placement', () => {
        seedTracks([loopedClip()]);
        const source = readClip('c-loop');
        const before = probe(source);

        expect(
            duplicateClipCore({
                clipId: 'c-loop',
                targetClipId: 'c-copy',
                computeStartBeat: (clip) => clip.startBeat + 6,
            })
        ).toBe(true);

        const copy = readClip('c-copy');
        expect(copy.startBeat).toBe(6);
        // A verbatim carry would derive advance 6 from the copy's placement;
        // the shifted carry reads exactly like the source.
        expect(copy.loopOriginBeat).toBe(6);
        expect(probe(copy)).toEqual(before);
    });

    it('pasteClip: the paste carries the source anchor at the paste placement', () => {
        seedTracks([loopedClip()]);
        const before = probe(readClip('c-loop'));
        playheadPositionRef.current = 10;

        selectClip('c-loop');
        expect(copySelectedClip()).toBe(true);
        expect(pasteClip()).toBe(true);

        const pasted = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((clip) => clip.name === 'Loop (paste)');
        if (!pasted) {
            throw new Error('Expected a pasted clip on the keys track');
        }
        expect(pasted.startBeat).toBe(10);
        expect(pasted.loopOriginBeat).toBe(10);
        expect(probe(pasted)).toEqual(before);
    });

    it('rippleInsertClip: shifted clips carry the anchor forward', () => {
        seedTracks([
            loopedClip(),
            loopedClip({ id: 'c-next', name: 'Next', startBeat: 16, endBeat: 24, loopOriginBeat: 16 }),
        ]);
        const loopBefore = probe(readClip('c-loop'));
        const nextBefore = probe(readClip('c-next'));

        rippleInsertClip({
            trackId: 't-keys',
            insertDuration: 2,
            plan: { shiftedClips: [{ clipId: 'c-next', origStartBeat: 16, origEndBeat: 24 }] },
        });

        const next = readClip('c-next');
        expect(next.startBeat).toBe(18);
        expect(next.loopOriginBeat).toBe(18);
        expect(probe(next)).toEqual(nextBefore);
        // The clip ahead of the insert point is untouched, anchor included.
        expect(readClip('c-loop').loopOriginBeat).toBe(0);
        expect(probe(readClip('c-loop'))).toEqual(loopBefore);
    });

    it('undoRippleInsertClip: a restored shift carries the anchor back (draw/discard round trip)', () => {
        // Discarding a clip drawn after a ripple insert restores the shifted
        // neighbors through undoRippleInsertClip: the undo reverses the
        // forward relocation, so the anchor rides the same delta back and the
        // restored clip reads exactly as before — advance zero included.
        seedTracks([loopedClip({ id: 'c-next', name: 'Next', startBeat: 16, endBeat: 24, loopOriginBeat: 16 })]);
        const nextBefore = probe(readClip('c-next'));
        expect(nextBefore.advance).toBe(0);

        const plan = { shiftedClips: [{ clipId: 'c-next', origStartBeat: 16, origEndBeat: 24 }] };
        rippleInsertClip({ trackId: 't-keys', insertDuration: LOOP_LENGTH, plan });
        expect(readClip('c-next').startBeat).toBe(20);
        expect(readClip('c-next').loopOriginBeat).toBe(20);

        undoRippleInsertClip({ trackId: 't-keys', plan });

        const restored = readClip('c-next');
        expect(restored.startBeat).toBe(16);
        expect(restored.loopOriginBeat).toBe(16);
        expect(probe(restored)).toEqual(nextBefore);
    });

    it('rippleMoveClip: the moved clip and the opened destination both carry the anchor', () => {
        seedTracks([
            loopedClip(),
            loopedClip({ id: 'c-next', name: 'Next', startBeat: 16, endBeat: 24, loopOriginBeat: 16 }),
        ]);
        const loopBefore = probe(readClip('c-loop'));
        const nextBefore = probe(readClip('c-next'));

        expect(
            rippleMoveClip({
                trackId: 't-keys',
                clipId: 'c-loop',
                newStartBeat: 20,
                clipDuration: 16,
                plan: {
                    gapClosedClips: [],
                    destinationOpenedClips: [{ clipId: 'c-next', origStartBeat: 16, origEndBeat: 24 }],
                },
            })
        ).toBe(true);

        const moved = readClip('c-loop');
        const next = readClip('c-next');
        expect(moved.startBeat).toBe(20);
        expect(moved.loopOriginBeat).toBe(20);
        expect(next.startBeat).toBe(32);
        expect(next.loopOriginBeat).toBe(32);
        expect(probe(moved)).toEqual(loopBefore);
        expect(probe(next)).toEqual(nextBefore);
    });

    it('rippleDeleteClips carries the anchor across the gap-closing shift and the undo restores it', () => {
        seedTracks([
            loopedClip({ id: 'c-gone', name: 'Gone', startBeat: 8, endBeat: 16 }),
            loopedClip({ id: 'c-next', name: 'Next', startBeat: 16, endBeat: 24, loopOriginBeat: 16 }),
        ]);
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: true });
        const plan = planRippleDelete({ trackId: 't-keys', clipIds: ['c-gone'] });
        if (!plan) {
            throw new Error('Expected a ripple delete plan');
        }
        const nextBefore = probe(readClip('c-next'));

        expect(rippleDeleteClips({ trackId: 't-keys', clipIds: ['c-gone'] })).not.toBeNull();

        const shifted = readClip('c-next');
        expect(shifted.startBeat).toBe(8);
        expect(shifted.loopOriginBeat).toBe(8);
        expect(probe(shifted)).toEqual(nextBefore);

        undoRippleDelete({
            trackId: 't-keys',
            removedClips: plan.removedClips,
            shiftedClips: plan.shiftedClips,
        });

        const restored = readClip('c-next');
        expect(restored.startBeat).toBe(16);
        expect(restored.loopOriginBeat).toBe(16);
        expect(probe(restored)).toEqual(nextBefore);
    });

    it('insertTime: clips right of the insert carry the anchor; a spanning clip stays anchored', () => {
        seedTracks([
            loopedClip(),
            loopedClip({ id: 'c-right', name: 'Right', startBeat: 8, endBeat: 16, loopOriginBeat: 8 }),
        ]);
        const loopBefore = probe(readClip('c-loop'));
        const rightBefore = probe(readClip('c-right'));

        const result = insertTime(6, 2);
        expect(result.status).toBe('applied');

        // The clip covering the insert point only grows: its head does not
        // move, so neither may its anchor.
        const spanning = readClip('c-loop');
        expect(spanning.startBeat).toBe(0);
        expect(spanning.endBeat).toBe(18);
        expect(spanning.loopOriginBeat).toBe(0);
        expect(probe(spanning)).toEqual(loopBefore);

        const right = readClip('c-right');
        expect(right.startBeat).toBe(10);
        expect(right.loopOriginBeat).toBe(10);
        expect(probe(right)).toEqual(rightBefore);
    });

    it('deleteTime: clips right of the deleted range carry the anchor; split fragments re-stamp to their own head', () => {
        seedTracks([
            loopedClip(),
            loopedClip({ id: 'c-after', name: 'After', startBeat: 12, endBeat: 20, loopOriginBeat: 12 }),
        ]);
        const afterBefore = probe(readClip('c-after'));

        const result = deleteTime(4, 8);
        expect(result.status).toBe('applied');

        const after = readClip('c-after');
        expect(after.startBeat).toBe(8);
        expect(after.loopOriginBeat).toBe(8);
        expect(probe(after)).toEqual(afterBefore);

        // The right fragment re-bases its notes by −splitBeat under
        // midiOffsetBeats 0 and moves its head to the operation start — a
        // fresh coordinate basis the source anchor has no meaning in. Carried
        // through, the source anchor derives a spurious advance whose window
        // silences the surviving material; the fragment re-stamps the anchor
        // to its own start, so the advance is zero and the window opens at
        // the head — the same two-pass projection the source read (#5198).
        const rightFragment = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((clip) => clip.name === 'Loop (R)');
        if (!rightFragment) {
            throw new Error('Expected the right fragment of the spanning clip');
        }
        expect(rightFragment.startBeat).toBe(4);
        expect(rightFragment.loopOriginBeat).toBe(4);
        expect(probe(rightFragment)).toEqual({
            advance: 0,
            window: [true, false],
            projection: ['head@0', 'head@4'],
        });
    });

    it('duplicateTimeRange: the copy carries the source anchor at the copy placement', () => {
        seedTracks([loopedClip()]);
        const before = probe(readClip('c-loop'));

        const result = duplicateTimeRange(0, 16);
        expect(result.status).toBe('applied');

        const copy = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((clip) => clip.id !== 'c-loop' && clip.name === 'Loop');
        if (!copy) {
            throw new Error('Expected the duplicated copy in the track store');
        }
        expect(copy.startBeat).toBe(16);
        expect(copy.loopOriginBeat).toBe(16);
        expect(probe(copy)).toEqual(before);
        // The source itself stays where and how it was.
        expect(probe(readClip('c-loop'))).toEqual(before);
    });
});
