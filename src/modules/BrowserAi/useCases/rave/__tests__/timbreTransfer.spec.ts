import { describe, it, expect } from 'vitest';

import { timbreTransfer } from '../timbreTransfer';

describe('timbreTransfer', () => {
    it('should blend source and target values proportionally to the blend amount', () => {
        const source = [{ timeSec: 0, values: [0, 10] }];
        const target = [{ timeSec: 0, values: [10, 30] }];

        expect(timbreTransfer(source, target, 0.5)).toEqual([{ timeSec: 0, values: [5, 20] }]);
    });

    it('should clamp the blend amount to the [0, 1] range', () => {
        const source = [{ timeSec: 0, values: [0] }];
        const target = [{ timeSec: 0, values: [100] }];

        expect(timbreTransfer(source, target, 5)[0]?.values[0]).toBe(100);
        expect(timbreTransfer(source, target, -5)[0]?.values[0]).toBe(0);
    });

    it('should cycle through fewer target vectors than source vectors', () => {
        const source = [
            { timeSec: 0, values: [0] },
            { timeSec: 1, values: [0] },
        ];
        const target = [{ timeSec: 0, values: [10] }];

        const result = timbreTransfer(source, target, 1);

        expect(result[0]?.values[0]).toBe(10);
        expect(result[1]?.values[0]).toBe(10);
    });

    it('should return the source vector unchanged when there are no target vectors', () => {
        const source = [{ timeSec: 0, values: [7] }];

        expect(timbreTransfer(source, [], 1)).toEqual(source);
    });

    it('should treat a missing target dimension as zero', () => {
        const source = [{ timeSec: 0, values: [10, 20] }];
        const target = [{ timeSec: 0, values: [10] }];

        expect(timbreTransfer(source, target, 1)[0]?.values).toEqual([10, 0]);
    });
});
