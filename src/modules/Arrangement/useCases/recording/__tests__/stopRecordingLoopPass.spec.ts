import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { stopRecording } from '../stopRecording';

import type { TakeLaneStoreState, takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import type { TransportState } from '#/modules/Transport/stores';
import type { Take } from '../../../models/TakeLane';
import type { TrackState, getTrackState } from '../../../repositories/track/getTrackState';
import type { setTrackState } from '../../../repositories/track/setTrackState';

const mocks = vi.hoisted(
    (): {
        getTrackState: Mock<typeof getTrackState>;
        setTrackState: Mock<typeof setTrackState>;
        transportStoreValue: TransportState | null;
        takeLaneStoreValue: { value: TakeLaneStoreState | null };
        takeLaneStoreSet: Mock<typeof takeLaneStore.set>;
        activeRecordingRef: { current: string[] };
        commitRecording: Mock<(clip: unknown) => Promise<void>>;
    } => ({
        getTrackState: vi.fn<typeof import('../../../repositories/track/getTrackState').getTrackState>(),
        setTrackState: vi.fn<typeof import('../../../repositories/track/setTrackState').setTrackState>(),
        transportStoreValue: null,
        takeLaneStoreValue: { value: { lanes: [] } },
        takeLaneStoreSet: vi.fn<typeof import('#/modules/Arrangement/stores/takeLaneStore').takeLaneStore.set>(),
        activeRecordingRef: { current: ['c1'] },
        commitRecording: vi.fn<(clip: unknown) => Promise<void>>(() => Promise.resolve()),
    })
);

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return mocks.transportStoreValue;
        },
    },
}));

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: mocks.takeLaneStoreSet,
    },
}));

vi.mock('../../../stores/activeRecordingRef', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
}));

vi.mock('../commitRecording', () => ({
    commitRecording: mocks.commitRecording,
}));

type TrackClip = TrackState['tracks'][number]['clips'][number];

function loopPassTake(id: string, startBeat: number, endBeat: number, sourceOffsetBeats?: number): Take {
    const take: Take = { id, clipId: 'c1', name: id, startBeat, endBeat, selected: false };
    if (sourceOffsetBeats !== undefined) {
        take.sourceOffsetBeats = sourceOffsetBeats;
    }
    return take;
}

function seedRecording(clip: Pick<TrackClip, 'type' | 'startBeat' | 'endBeat'>, takes: Take[]) {
    mocks.getTrackState.mockReturnValue({
        tracks: [{ id: 't1', clips: [{ id: 'c1', ...clip }] }],
    } as unknown as TrackState);
    mocks.transportStoreValue = { playheadPosition: 0 } as unknown as TransportState;
    mocks.takeLaneStoreValue.value = {
        lanes: [{ id: 'lane-1', trackId: 't1', takes, activeCompRegions: [] }],
    };
}

function writtenClip(): TrackClip {
    return mocks.setTrackState.mock.calls[0]![0].tracks[0]!.clips[0]!;
}

function writtenClipEnd(): number {
    return writtenClip().endBeat;
}

function writtenTakes(): Take[] {
    const written = mocks.takeLaneStoreSet.mock.calls[0]?.[0];
    if (!written) {
        throw new Error('stopRecording wrote no take-lane state');
    }
    const lane = written.lanes[0];
    if (!lane) {
        throw new Error('stopRecording wrote no take lane');
    }
    return lane.takes;
}

function writtenTakeSpans(): (readonly [string, number, number])[] {
    return writtenTakes().map((take) => [take.id, take.startBeat, take.endBeat] as const);
}

describe('stopRecording during a loop recording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.activeRecordingRef.current = ['c1'];
    });

    it('keeps a MIDI clip and its completed pass takes covering the loop when Stop lands mid-pass', () => {
        seedRecording({ type: 'midi', startBeat: 0, endBeat: 0 }, [
            loopPassTake('pass-1', 0, 4, 0),
            loopPassTake('pass-2', 0, 4, 4),
        ]);

        void stopRecording(1.5);

        expect(writtenClipEnd()).toBeGreaterThanOrEqual(4);
        expect(writtenTakeSpans()).toEqual([
            ['pass-1', 0, 4],
            ['pass-2', 0, 4],
        ]);
    });

    it('ends only the in-progress pass at the stop beat after three passes', () => {
        seedRecording({ type: 'midi', startBeat: 0, endBeat: 0 }, [
            loopPassTake('pass-3', 0, 0),
            loopPassTake('pass-1', 0, 4, 0),
            loopPassTake('pass-2', 0, 4, 4),
        ]);

        void stopRecording(3);

        expect(writtenClipEnd()).toBe(4);
        expect(writtenTakeSpans()).toEqual([
            ['pass-3', 0, 3],
            ['pass-1', 0, 4],
            ['pass-2', 0, 4],
        ]);
    });

    it('treats an audio loop recording the same, including one that started before the loop', () => {
        seedRecording({ type: 'audio', startBeat: 1, endBeat: 1 }, [loopPassTake('pass-1', 2, 6, 1)]);

        void stopRecording(3);

        expect(writtenClipEnd()).toBe(6);
        expect(writtenTakeSpans()).toEqual([['pass-1', 2, 6]]);
    });

    it('closes the clip at the stop beat when it lies beyond every completed pass', () => {
        seedRecording({ type: 'audio', startBeat: 0, endBeat: 0 }, [loopPassTake('pass-1', 0, 4, 0)]);

        void stopRecording(9);

        expect(writtenClipEnd()).toBe(9);
        expect(writtenTakeSpans()).toEqual([['pass-1', 0, 4]]);
    });

    it('starts a MIDI first pass where its media does when it began before the record point', () => {
        seedRecording({ type: 'midi', startBeat: 12, endBeat: 12 }, [
            loopPassTake('pass-1', 8, 16, 0),
            loopPassTake('pass-2', 8, 16, 4),
        ]);

        void stopRecording(14);

        expect(writtenTakeSpans()).toEqual([
            ['pass-1', 12, 16],
            ['pass-2', 8, 16],
        ]);
        const offsets = writtenTakes().map((take) => take.sourceOffsetBeats);
        expect(offsets).toEqual([0, 4]);
        // A MIDI pass sounds from its clip's start, bounded by it, so none is placed.
        expect(writtenTakes().every((take) => !('passStartBeats' in take))).toBe(true);
    });

    it('keeps a MIDI clip recorded inside the loop on its record point, with no media offset', () => {
        seedRecording({ type: 'midi', startBeat: 12, endBeat: 12 }, [
            loopPassTake('pass-1', 8, 16, 0),
            loopPassTake('pass-2', 8, 16, 4),
        ]);

        void stopRecording(14);

        expect(writtenClip()).toMatchObject({ startBeat: 12, endBeat: 16 });
        expect(writtenClip()).not.toHaveProperty('midiOffsetBeats');
        expect(mocks.commitRecording).toHaveBeenCalledWith(expect.objectContaining({ startBeat: 12, endBeat: 16 }));
    });

    it('does not place the takes of an audio recording, which its capture terminal owns', () => {
        seedRecording({ type: 'audio', startBeat: 12, endBeat: 12 }, [loopPassTake('pass-1', 8, 16, 0)]);

        void stopRecording(14);

        const offsets = writtenTakes().map((take) => take.sourceOffsetBeats);
        expect(offsets).toEqual([0]);
        expect(writtenTakes()[0]?.passStartBeats).toBeUndefined();
        // Its capture terminal places the clip as well.
        expect(writtenClip().startBeat).toBe(12);
    });
});
