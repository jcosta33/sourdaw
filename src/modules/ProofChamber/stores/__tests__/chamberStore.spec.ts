import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultChamberState } from '../../models/ProofChamberState';
import { chamberStore, type ChamberStoreState } from '../chamberStore';

const defaultState: ChamberStoreState = {
    activeInstanceId: null,
    instances: {},
};

describe('chamberStore defaults', () => {
    beforeEach(() => {
        chamberStore.set(defaultState);
    });

    it('seeds with no active instance and an empty instance map', () => {
        expect(chamberStore.value).toEqual(defaultState);
    });
});

describe('chamberStore writes', () => {
    beforeEach(() => {
        chamberStore.set(defaultState);
    });

    it('reads back a full instance map written with set', () => {
        const first = createDefaultChamberState('chamber-1');
        const populated: ChamberStoreState = {
            activeInstanceId: 'chamber-1',
            instances: { 'chamber-1': first },
        };

        chamberStore.set(populated);

        expect(chamberStore.value).toEqual(populated);
    });

    it('registers a new instance via update while preserving existing instances', () => {
        const first = createDefaultChamberState('chamber-1');
        chamberStore.set({ activeInstanceId: 'chamber-1', instances: { 'chamber-1': first } });

        const second = createDefaultChamberState('chamber-2');
        chamberStore.update((current) => ({
            activeInstanceId: 'chamber-2',
            instances: { ...(current?.instances ?? {}), 'chamber-2': second },
        }));

        expect(chamberStore.value?.activeInstanceId).toBe('chamber-2');
        expect(chamberStore.value?.instances['chamber-1']).toEqual(first);
        expect(chamberStore.value?.instances['chamber-2']).toEqual(second);
    });

    it('mutates a single instance field via update, leaving other instances untouched', () => {
        const first = createDefaultChamberState('chamber-1');
        const second = createDefaultChamberState('chamber-2');
        chamberStore.set({
            activeInstanceId: 'chamber-1',
            instances: { 'chamber-1': first, 'chamber-2': second },
        });

        chamberStore.update((current) => {
            const instances = current?.instances ?? {};
            const target = instances['chamber-1'];
            if (!target) {
                return current;
            }
            return {
                ...current,
                activeInstanceId: current?.activeInstanceId ?? null,
                instances: { ...instances, 'chamber-1': { ...target, isBypassed: true } },
            };
        });

        expect(chamberStore.value?.instances['chamber-1']?.isBypassed).toBe(true);
        expect(chamberStore.value?.instances['chamber-2']).toEqual(second);
    });

    it('clears the active instance while keeping the instance map intact', () => {
        const first = createDefaultChamberState('chamber-1');
        chamberStore.set({ activeInstanceId: 'chamber-1', instances: { 'chamber-1': first } });

        chamberStore.update((current) => ({ ...(current ?? defaultState), activeInstanceId: null }));

        expect(chamberStore.value?.activeInstanceId).toBeNull();
        expect(chamberStore.value?.instances['chamber-1']).toEqual(first);
    });
});

describe('chamberStore subscribe/clear', () => {
    beforeEach(() => {
        chamberStore.set(defaultState);
    });

    it('notifies subscribers on set and stops after unsubscribe', () => {
        const seen: (ChamberStoreState | null)[] = [];
        const unsubscribe = chamberStore.subscribe((value) => {
            seen.push(value);
        });

        const first = createDefaultChamberState('chamber-1');
        chamberStore.set({ activeInstanceId: 'chamber-1', instances: { 'chamber-1': first } });
        unsubscribe();
        chamberStore.set(defaultState);

        expect(seen).toHaveLength(1);
        expect(seen[0]?.activeInstanceId).toBe('chamber-1');
    });

    it('clears back to null', () => {
        const first = createDefaultChamberState('chamber-1');
        chamberStore.set({ activeInstanceId: 'chamber-1', instances: { 'chamber-1': first } });

        chamberStore.clear();

        expect(chamberStore.value).toBeNull();
    });
});
