import { describe, it, expect } from 'vitest';

import { handleReorderDevices } from '../../handlers/device/handleReorderDevices';
import { handleDiscardCreatedTrack } from '../../handlers/track/discardCreatedTrack';
import * as subject from '../getArrangementHandlers';

describe('getArrangementHandlers', () => {
    it('should export getArrangementHandlers', () => {
        expect(subject.getArrangementHandlers).toBeDefined();
        const time = typeof subject.getArrangementHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('registers the internal created-track compensation handler', () => {
        expect(subject.getArrangementHandlers().discardCreatedTrack).toBe(handleDiscardCreatedTrack);
    });

    it('registers the revision-bound device reorder handler', () => {
        expect(subject.getArrangementHandlers().reorderDevices).toBe(handleReorderDevices);
    });

    it('keeps the four public legacy VCA keys plus only the internal restoration handler', () => {
        const vcaHandlerKeys = Object.keys(subject.getArrangementHandlers()).filter((key) =>
            key.toLowerCase().includes('vca')
        );

        expect(vcaHandlerKeys).toEqual([
            'createVcaGroup',
            'assignToVca',
            'removeFromVca',
            'setVcaGain',
            'restoreLegacyVcaState',
        ]);
    });
});
