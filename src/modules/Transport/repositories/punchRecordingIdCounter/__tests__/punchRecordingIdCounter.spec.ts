import { describe, it, expect } from 'vitest';
import { getNextCaptureId } from '../getNextCaptureId';
import { getNextPunchId } from '../getNextPunchId';

describe('punchRecordingIdCounter', () => {
    describe('getNextCaptureId', () => {
        it('should return a capture ID and increment it', () => {
            const id1 = getNextCaptureId();
            const id2 = getNextCaptureId();
            expect(id1.startsWith('cap-')).toBe(true);
            expect(id1).not.toBe(id2);
            
            const n1 = parseInt(id1.split('-')[1]!);
            const n2 = parseInt(id2.split('-')[1]!);
            expect(n2).toBe(n1 + 1);
        });
    });

    describe('getNextPunchId', () => {
        it('should return a punch ID and increment it', () => {
            const id1 = getNextPunchId();
            const id2 = getNextPunchId();
            expect(id1.startsWith('punch-')).toBe(true);
            expect(id1).not.toBe(id2);
            
            const n1 = parseInt(id1.split('-')[1]!);
            const n2 = parseInt(id2.split('-')[1]!);
            expect(n2).toBe(n1 + 1);
        });
    });
});
