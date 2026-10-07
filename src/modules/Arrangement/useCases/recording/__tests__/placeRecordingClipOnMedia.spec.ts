import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Take } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { placeRecordingClipOnMedia } from '../placeRecordingClipOnMedia';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));

function take(id: string, clipId: string, startBeat: number, sourceOffsetBeats?: number): Take {
    const staged: Take = { id, clipId, name: id, startBeat, endBeat: startBeat + 8, selected: false };
    if (sourceOffsetBeats !== undefined) {
        staged.sourceOffsetBeats = sourceOffsetBeats;
    }
    return staged;
}

function stage(takes: Take[]): void {
    mocks.takeLaneStoreValue.value = { lanes: [{ id: 'lane-1', trackId: 't1', takes, activeCompRegions: [] }] };
}

describe('placeRecordingClipOnMedia', () => {
    beforeEach(() => {
        mocks.takeLaneStoreValue.value = null;
    });

    it('opens a recording begun inside the loop at the loop start, its offset negative by the gap', () => {
        // Loop [8,16) recorded from beat 12 with half a beat of latency: the
        // media begins at 11.5, and both passes span the loop as staged.
        stage([take('take-1', 'rec', 12), take('pass-1', 'rec', 8, 0), take('pass-2', 'rec', 8, 4)]);

        expect(placeRecordingClipOnMedia('rec', 11.5)).toEqual({ startBeat: 8, mediaOffsetBeats: -3.5 });
    });

    it('opens a recording on its media origin when every pass begins after it', () => {
        stage([take('pass-1', 'rec', 2, 1)]);

        expect(placeRecordingClipOnMedia('rec', 0.5)).toEqual({ startBeat: 0.5, mediaOffsetBeats: 0 });
    });

    it('clamps a recording whose media began before beat 0, skipping the samples before it', () => {
        stage([take('pass-1', 'rec', 0, 0.5)]);

        expect(placeRecordingClipOnMedia('rec', -0.5)).toEqual({ startBeat: 0, mediaOffsetBeats: 0.5 });
    });

    it('reads only the passes of its own recording', () => {
        stage([take('take-1', 'rec', 4), take('other-pass', 'other', 0, 2)]);

        expect(placeRecordingClipOnMedia('rec', 4)).toEqual({ startBeat: 4, mediaOffsetBeats: 0 });
    });

    it('opens a recording on its media origin when no lane exists', () => {
        expect(placeRecordingClipOnMedia('rec', 3)).toEqual({ startBeat: 3, mediaOffsetBeats: 0 });
    });
});
