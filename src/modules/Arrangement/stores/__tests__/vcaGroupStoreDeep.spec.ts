import { describe, it, expect, beforeEach } from 'vitest';
import {
    vcaGroupStore,
    getVcaGroupsState,
    setVcaGroupsState,
    defaultVcaGroupState,
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
        const unsub = vcaGroupStore.subscribe(() => { called = true; });
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
});
