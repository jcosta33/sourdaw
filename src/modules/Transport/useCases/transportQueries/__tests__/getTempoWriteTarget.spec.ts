import { describe, it, expect, beforeEach, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { getTempoWriteTarget } from '../getTempoWriteTarget';

type TempoChangeFixture = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };
type TempoMapFixture = { changes: TempoChangeFixture[] };

const { transportRef, tempoMapRef, livePlayheadRef } = vi.hoisted(() => {
    const transportRef: { value: TransportState | null } = { value: null };
    const tempoMapRef: { value: TempoMapFixture | null } = { value: null };
    const livePlayheadRef = { current: 0 };
    return { transportRef, tempoMapRef, livePlayheadRef };
});

vi.mock('../../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return transportRef.value;
        },
    },
}));

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return tempoMapRef.value;
        },
    },
}));

vi.mock('../../../stores/playheadPositionRef', () => ({
    playheadPositionRef: livePlayheadRef,
}));

const rampMap: TempoMapFixture = {
    changes: [
        { id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' },
        { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
    ],
};

const stepMap: TempoMapFixture = {
    changes: [
        { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
        { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
    ],
};

describe('getTempoWriteTarget', () => {
    beforeEach(() => {
        transportRef.value = { ...defaultTransportState, tempo: 120, playheadPosition: 0 };
        tempoMapRef.value = { changes: [] };
        livePlayheadRef.current = 0;
    });

    it('targets the base tempo when there is no tempo map', () => {
        expect(getTempoWriteTarget()).toEqual({ tempo: 120, tempoChangeId: null, writable: true });
    });

    it('targets the tempo event governing the stopped playhead', () => {
        tempoMapRef.value = stepMap;
        transportRef.value = { ...transportRef.value!, playheadPosition: 9 };

        expect(getTempoWriteTarget()).toEqual({ tempo: 130, tempoChangeId: 'tc-b', writable: true });
    });

    it('reads the live playhead ref while playing, not the play-start position', () => {
        tempoMapRef.value = stepMap;
        transportRef.value = { ...transportRef.value!, isPlaying: true, playheadPosition: 0 };
        livePlayheadRef.current = 12;

        expect(getTempoWriteTarget()).toEqual({ tempo: 130, tempoChangeId: 'tc-b', writable: true });
    });

    it('reads the store position when stopped even if the ref lags behind', () => {
        tempoMapRef.value = stepMap;
        transportRef.value = { ...transportRef.value!, isPlaying: false, playheadPosition: 12 };
        livePlayheadRef.current = 0;

        expect(getTempoWriteTarget()).toEqual({ tempo: 130, tempoChangeId: 'tc-b', writable: true });
    });

    it('reports the interpolated tempo as unwritable inside a ramp', () => {
        tempoMapRef.value = rampMap;
        transportRef.value = { ...transportRef.value!, playheadPosition: 4 };

        expect(getTempoWriteTarget()).toEqual({ tempo: 110, tempoChangeId: 'tc-a', writable: false });
    });

    it('resolves a named change and ignores the playhead entirely', () => {
        tempoMapRef.value = stepMap;
        transportRef.value = { ...transportRef.value!, playheadPosition: 12 };

        expect(getTempoWriteTarget({ tempoChangeId: 'tc-a' })).toEqual({
            tempo: 90,
            tempoChangeId: 'tc-a',
            writable: true,
        });
    });

    it('returns null for a named change that is no longer in the map', () => {
        tempoMapRef.value = stepMap;

        expect(getTempoWriteTarget({ tempoChangeId: 'tc-gone' })).toBeNull();
    });

    it('returns null when there is no transport state to resolve against', () => {
        transportRef.value = null;

        expect(getTempoWriteTarget()).toBeNull();
    });
});
