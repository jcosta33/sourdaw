import { describe, it, expect } from 'vitest';

import * as subject from '../getArrangementHandlers';

describe('getArrangementHandlers', () => {
    it('should export getArrangementHandlers', () => {
        expect(subject.getArrangementHandlers).toBeDefined();
        const time = typeof subject.getArrangementHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('keeps exactly the four legacy VCA registry keys during the foundation', () => {
        const vcaHandlerKeys = Object.keys(subject.getArrangementHandlers()).filter((key) =>
            key.toLowerCase().includes('vca')
        );

        expect(vcaHandlerKeys).toEqual(['createVcaGroup', 'assignToVca', 'removeFromVca', 'setVcaGain']);
    });
});
