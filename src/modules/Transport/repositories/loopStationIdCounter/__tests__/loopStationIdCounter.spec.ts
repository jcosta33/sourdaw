import { describe, it, expect } from 'vitest';
import { getNextLayerId } from '../getNextLayerId';
import { getNextSlotId } from '../getNextSlotId';

describe('loopStationIdCounter', () => {
    describe('getNextLayerId', () => {
        it('should return a layer ID and increment it', () => {
            const id1 = getNextLayerId();
            const id2 = getNextLayerId();
            expect(id1.startsWith('layer-')).toBe(true);
            expect(id1).not.toBe(id2);
            
            const n1 = parseInt(id1.split('-')[1]!);
            const n2 = parseInt(id2.split('-')[1]!);
            expect(n2).toBe(n1 + 1);
        });
    });

    describe('getNextSlotId', () => {
        it('should return a slot ID and increment it', () => {
            const id1 = getNextSlotId();
            const id2 = getNextSlotId();
            expect(id1.startsWith('loop-')).toBe(true);
            expect(id1).not.toBe(id2);
            
            const n1 = parseInt(id1.split('-')[1]!);
            const n2 = parseInt(id2.split('-')[1]!);
            expect(n2).toBe(n1 + 1);
        });
    });
});
