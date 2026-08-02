import { describe, it, expect, beforeEach } from 'vitest';

import {
    vcaGroupStore,
    getVcaGroupsState,
    sanitizeVcaGroups,
    setVcaGroupsState,
    type VcaGroup,
} from '../vcaGroupStore';

const make_group = (id: string): VcaGroup => ({
    id,
    name: `VCA ${id}`,
    gain: 0.8,
    muted: false,
    trackIds: ['t1', 't2'],
});

describe('vcaGroupStore', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
    });

    it('getVcaGroupsState returns empty initially', () => {
        expect(getVcaGroupsState()).toEqual([]);
    });

    it('setVcaGroupsState stores groups', () => {
        const groups = [make_group('g1'), make_group('g2')];
        setVcaGroupsState(groups);
        expect(getVcaGroupsState()).toEqual(groups);
        expect(getVcaGroupsState()).toHaveLength(2);
    });

    it('setVcaGroupsState replaces existing groups', () => {
        setVcaGroupsState([make_group('old')]);
        setVcaGroupsState([make_group('new1'), make_group('new2')]);
        const result = getVcaGroupsState();
        expect(result).toHaveLength(2);
        expect(result[0]!.id).toBe('new1');
    });

    it('clears with empty array', () => {
        setVcaGroupsState([make_group('g1')]);
        setVcaGroupsState([]);
        expect(getVcaGroupsState()).toEqual([]);
    });

    it('subscribe fires on set', () => {
        let called = false;
        const unsub = vcaGroupStore.subscribe(() => {
            called = true;
        });
        setVcaGroupsState([make_group('g1')]);
        expect(called).toBe(true);
        unsub();
    });

    it('preserves group properties', () => {
        setVcaGroupsState([make_group('g1')]);
        const g = getVcaGroupsState()[0]!;
        expect(g.name).toBe('VCA g1');
        expect(g.gain).toBe(0.8);
        expect(g.muted).toBe(false);
        expect(g.trackIds).toEqual(['t1', 't2']);
    });

    it('returns an empty array when the store has no value yet', () => {
        // Before the store is ever written, .value is null — readers must never see null.
        vcaGroupStore.set(null);

        expect(getVcaGroupsState()).toEqual([]);
    });

    describe('sanitizeVcaGroups', () => {
        it('keeps a well-formed persisted group and copies its trackIds', () => {
            const persisted = [{ id: 'g1', name: 'Drums', gain: 0.5, muted: true, trackIds: ['t1'] }];

            const decoded = sanitizeVcaGroups(persisted);

            expect(decoded).toEqual([{ id: 'g1', name: 'Drums', gain: 0.5, muted: true, trackIds: ['t1'] }]);
            expect(decoded[0]?.trackIds).not.toBe(persisted[0]?.trackIds);
        });

        it('drops rows that could not drive a gain and keeps the ones that can', () => {
            const decoded = sanitizeVcaGroups([
                { id: 'g-nan', name: 'Bad', gain: Number.NaN, muted: false, trackIds: [] },
                { id: '', name: 'No id', gain: 1, muted: false, trackIds: [] },
                { id: 'g-ok', name: 'Good', gain: 0.25, muted: false, trackIds: ['t1'] },
                { id: 'g-ok', name: 'Duplicate', gain: 2, muted: true, trackIds: ['t2'] },
            ]);

            expect(decoded.map((group) => group.id)).toEqual(['g-ok']);
            expect(decoded[0]?.gain).toBe(0.25);
        });

        it('decodes a non-array to no groups', () => {
            expect(sanitizeVcaGroups(undefined)).toEqual([]);
            expect(sanitizeVcaGroups({ groups: [] })).toEqual([]);
        });
    });
});
