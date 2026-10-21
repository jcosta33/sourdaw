import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Take } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { stageRecordingTake } from '../stageRecordingTake';

const fixture = vi.hoisted(() => ({
    state: { lanes: [] } as TakeLaneStoreState,
    stage: vi.fn(),
    replacementTakeId: vi.fn<() => string | undefined>(),
}));
vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return fixture.state;
        },
        set: (state: TakeLaneStoreState) => {
            fixture.state = state;
        },
    },
}));
vi.mock('../recordingPassTiming', () => ({
    recordingPassTiming: {
        stage: fixture.stage,
        replacementTakeId: fixture.replacementTakeId,
        nextStartBeat: () => undefined,
    },
}));

function initialTake(): Take {
    return { id: 'initial', clipId: 'capture', name: 'Take 1', startBeat: 11.8, endBeat: 12.8, selected: false };
}
const finalPass = {
    trackId: 'track',
    clipId: 'capture',
    name: 'unused new label',
    startBeat: 8,
    endBeat: 8.1,
    sourceOffsetBeats: 0.2,
    passEndContextSeconds: 50.35,
    provisionalTakeId: 'initial',
};

describe('provisional recording take staging', () => {
    beforeEach(() => {
        fixture.stage.mockReset();
        fixture.replacementTakeId.mockReset();
        fixture.state = { lanes: [{ id: 'lane', trackId: 'track', takes: [initialTake()], activeCompRegions: [] }] };
    });

    it('finalizes the existing open take without changing its identity or name', () => {
        stageRecordingTake(finalPass);
        const expected = { ...initialTake(), startBeat: 8, endBeat: 8.1, sourceOffsetBeats: 0.2 };
        expect(fixture.state.lanes[0]!.takes).toEqual([expected]);
        expect(fixture.stage).toHaveBeenCalledWith(expected, 50.35, undefined);
    });

    it.each(['absent', 'wrong clip', 'completed'])('rejects an explicitly requested %s provisional owner', (owner) => {
        if (owner === 'absent') {
            fixture.state.lanes[0]!.takes = [];
        } else if (owner === 'wrong clip') {
            fixture.state.lanes[0]!.takes[0]!.clipId = 'foreign';
        } else {
            fixture.state.lanes[0]!.takes[0]!.sourceOffsetBeats = 0;
        }
        const before = structuredClone(fixture.state);
        expect(() => stageRecordingTake(finalPass)).toThrow('Recording provisional take is not available');
        expect(fixture.state).toEqual(before);
        expect(fixture.stage).not.toHaveBeenCalled();
    });

    it('keeps cancelled planned replacement on its original start and source identity', () => {
        const planned = { ...initialTake(), startBeat: 8, endBeat: 12, sourceOffsetBeats: 0 };
        fixture.state.lanes[0]!.takes = [planned];
        fixture.replacementTakeId.mockReturnValue(planned.id);
        stageRecordingTake({
            trackId: 'track',
            clipId: 'capture',
            name: 'ignored',
            startBeat: 9,
            endBeat: 11.5,
            sourceOffsetBeats: 4,
        });
        expect(fixture.state.lanes[0]!.takes).toEqual([{ ...planned, endBeat: 11.5 }]);
    });

    it('continues ordinary take staging without a replacement request', () => {
        stageRecordingTake({
            trackId: 'track',
            clipId: 'midi',
            name: 'MIDI pass',
            startBeat: 8,
            endBeat: 12,
            sourceOffsetBeats: 0,
        });
        expect(fixture.state.lanes[0]!.takes).toHaveLength(2);
        expect(fixture.state.lanes[0]!.takes[0]).toEqual(initialTake());
        expect(fixture.state.lanes[0]!.takes[1]).toMatchObject({
            clipId: 'midi',
            name: 'MIDI pass',
            startBeat: 8,
            endBeat: 12,
            sourceOffsetBeats: 0,
        });
    });
});
