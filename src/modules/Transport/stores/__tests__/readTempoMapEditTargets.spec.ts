import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTempoMapEditTargets } from '../readTempoMapEditTargets';
import { tempoMapStore } from '../tempoMapStore';

describe('tempo-map edit target reads', () => {
    beforeEach(() => tempoMapStore.set({ changes: [] }));
    afterEach(() => tempoMapStore.set({ changes: [] }));

    it('preserves the absence of an uninstalled map', () => {
        tempoMapStore.set(null);
        expect(readTempoMapEditTargets({ type: 'add', beat: 4, tempo: 90 })).toBeNull();
    });

    it('reads the last EPS collision in input order without selecting an unrelated row', () => {
        const arrival = { id: 'arrival', beat: 4, tempo: 80, curve: 'instant' as const };
        const head = { id: 'head', beat: 4, tempo: 140, curve: 'linear' as const };
        tempoMapStore.set({ changes: [arrival, head, { ...arrival, id: 'other', beat: 8 }] });
        expect(readTempoMapEditTargets({ type: 'add', beat: 4 + 5e-7, tempo: 140 })).toEqual([head]);
        expect(readTempoMapEditTargets({ type: 'add', beat: 6, tempo: 140 })).toBeNull();
    });

    it('returns an isolated target and leaves the current row unchanged', () => {
        const row = { id: 'owner', beat: 4, tempo: 90, curve: 'instant' as const };
        tempoMapStore.set({ changes: [row] });
        const result = readTempoMapEditTargets({ type: 'update', id: row.id, tempo: 90 });
        expect(result).toEqual([row]);
        expect(result?.[0]).not.toBe(tempoMapStore.value?.changes[0]);
        expect(tempoMapStore.value?.changes).toEqual([row]);
    });

    it('retains missing update and remove or replace destination shapes', () => {
        tempoMapStore.set({ changes: [{ id: 'peer', beat: 8, tempo: 90, curve: 'instant' }] });
        expect(readTempoMapEditTargets({ type: 'update', id: 'missing', tempo: 90 })).toEqual([]);
        expect(readTempoMapEditTargets({ type: 'remove', id: 'peer' })).toEqual([]);
        expect(readTempoMapEditTargets({ type: 'replace', changes: [] })).toEqual([]);
    });
});
