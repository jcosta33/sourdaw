import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { tempoMapStore, type TempoChange, type TempoMapStoreState } from '../../stores/tempoMapStore';
import {
    timeSignatureMapStore,
    type TimeSignatureChange,
    type TimeSignatureMapStoreState,
} from '../../stores/timeSignatureMapStore';
import { restoreTimelineMapSnapshot } from '../restoreTimelineMapSnapshot';

describe('restoreTimelineMapSnapshot', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('preserves exact paired map objects and their IDs', () => {
        const tempo_map = {
            changes: [
                { id: 'tempo-a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-b', beat: 8, tempo: 144, curve: 'linear' },
            ],
        } satisfies TempoMapStoreState;
        const time_signature_map = {
            changes: [
                { id: 'signature-a', beat: 0, numerator: 4, denominator: 4 },
                { id: 'signature-b', beat: 16, numerator: 7, denominator: 8 },
            ],
        } satisfies TimeSignatureMapStoreState;

        restoreTimelineMapSnapshot({ tempoMap: tempo_map, timeSignatureMap: time_signature_map });

        expect(tempoMapStore.value).toBe(tempo_map);
        expect(timeSignatureMapStore.value).toBe(time_signature_map);
        expect(tempoMapStore.value?.changes.map((change) => change.id)).toEqual(['tempo-a', 'tempo-b']);
        expect(timeSignatureMapStore.value?.changes.map((change) => change.id)).toEqual(['signature-a', 'signature-b']);
    });

    it('sanitizes malformed or omitted neighboring map snapshots independently', () => {
        const valid_tempo_change = {
            id: 'tempo-valid',
            beat: 4,
            tempo: 132,
            curve: 'linear',
        } satisfies TempoChange;
        const valid_time_signature_change = {
            id: 'signature-valid',
            beat: 12,
            numerator: 3,
            denominator: 4,
        } satisfies TimeSignatureChange;
        timeSignatureMapStore.set({ changes: [valid_time_signature_change] });

        restoreTimelineMapSnapshot({
            tempoMap: {
                changes: [valid_tempo_change, { id: 'tempo-invalid', beat: -1, tempo: 132, curve: 'linear' }],
            },
            timeSignatureMap: undefined,
        });

        expect(tempoMapStore.value).toEqual({ changes: [valid_tempo_change] });
        expect(timeSignatureMapStore.value).toEqual({ changes: [] });

        restoreTimelineMapSnapshot({
            tempoMap: undefined,
            timeSignatureMap: {
                changes: [
                    valid_time_signature_change,
                    { id: 'signature-invalid', beat: 16, numerator: 0, denominator: 4 },
                ],
            },
        });

        expect(tempoMapStore.value).toEqual({ changes: [] });
        expect(timeSignatureMapStore.value).toEqual({ changes: [valid_time_signature_change] });
    });
});
