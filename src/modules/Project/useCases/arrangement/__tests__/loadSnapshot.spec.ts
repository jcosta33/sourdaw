import { describe, it, expect, vi, beforeEach } from 'vitest';

import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { type ArrangementSnapshot } from '../../../stores/arrangementStore';
import { loadSnapshot } from '../helpers';

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: { set: vi.fn() },
    takeLaneStore: { set: vi.fn() },
    trackStore: { set: vi.fn() },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    normalizeTrack: (track: unknown) => track,
}));
vi.mock('#/modules/Automation/stores', () => ({ automationStore: { set: vi.fn() } }));
vi.mock('#/modules/MIDI/stores', () => ({ midiStore: { set: vi.fn() } }));
vi.mock('#/modules/Transport/stores', () => ({
    tempoMapStore: { set: vi.fn() },
    timeSignatureMapStore: { set: vi.fn() },
}));

const baseSnapshot: ArrangementSnapshot = {
    id: 'a1',
    name: 'Arrangement 1',
    tracks: { tracks: [], selectedTrackId: null },
    automation: { lanes: [] },
    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
};

describe('loadSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears the shared tempo/timeSig/marker/takeLane stores when the snapshot omits those fields', () => {
        // A snapshot captured from an arrangement that had no tempo map, markers,
        // or take lanes. Switching to it must not leave the previous arrangement's
        // values installed in the shared stores.
        loadSnapshot(baseSnapshot);

        expect(vi.mocked(tempoMapStore.set)).toHaveBeenCalledWith({ changes: [] });
        expect(vi.mocked(timeSignatureMapStore.set)).toHaveBeenCalledWith({ changes: [] });
        expect(vi.mocked(markerStore.set)).toHaveBeenCalledWith({ markers: [], sections: [] });
        expect(vi.mocked(takeLaneStore.set)).toHaveBeenCalledWith({ lanes: [] });
    });

    it('writes the snapshot values when present', () => {
        const snapshot: ArrangementSnapshot = {
            ...baseSnapshot,
            tempoMap: { changes: [{ id: 't1', beat: 0, tempo: 140, curve: 'instant' }] },
            timeSignatureMap: { changes: [{ id: 's1', beat: 0, numerator: 3, denominator: 4 }] },
            markers: { markers: [{ id: 'm1', beat: 4, name: 'Verse', color: '#fff' }], sections: [] },
            takeLanes: { lanes: [] },
        };

        loadSnapshot(snapshot);

        expect(vi.mocked(tempoMapStore.set)).toHaveBeenCalledWith(snapshot.tempoMap);
        expect(vi.mocked(timeSignatureMapStore.set)).toHaveBeenCalledWith(snapshot.timeSignatureMap);
        expect(vi.mocked(markerStore.set)).toHaveBeenCalledWith(snapshot.markers);
        expect(vi.mocked(takeLaneStore.set)).toHaveBeenCalledWith(snapshot.takeLanes);
        expect(vi.mocked(trackStore.set)).toHaveBeenCalled();
        expect(vi.mocked(automationStore.set)).toHaveBeenCalledWith(snapshot.automation);
        expect(vi.mocked(midiStore.set)).toHaveBeenCalledWith(snapshot.midi);
    });
});
