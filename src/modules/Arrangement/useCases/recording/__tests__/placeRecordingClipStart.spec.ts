import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Take } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { placeRecordingClipStart } from '../placeRecordingClipStart';

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

describe('placeRecordingClipStart', () => {
    beforeEach(() => {
        mocks.takeLaneStoreValue.value = null;
    });

    it('opens a recording begun inside the loop at the loop start', () => {
        // Loop [8,16) recorded from beat 12: both passes span the loop as staged.
        stage([take('take-1', 'rec', 12), take('pass-1', 'rec', 8, 0), take('pass-2', 'rec', 8, 4)]);

        expect(placeRecordingClipStart('rec', 11.5)).toBe(8);
    });

    it('keeps the opening beat when every pass begins after it', () => {
        stage([take('pass-1', 'rec', 2, 1)]);

        expect(placeRecordingClipStart('rec', 0.5)).toBe(0.5);
    });

    it('never opens before beat 0', () => {
        stage([take('pass-1', 'rec', 0, 0.5)]);

        expect(placeRecordingClipStart('rec', -0.5)).toBe(0);
    });

    it('reads only the passes of its own recording', () => {
        stage([take('take-1', 'rec', 4), take('other-pass', 'other', 0, 2)]);

        expect(placeRecordingClipStart('rec', 4)).toBe(4);
    });

    it('keeps the opening beat when no lane exists', () => {
        expect(placeRecordingClipStart('rec', 3)).toBe(3);
    });
});
