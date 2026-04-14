import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInvertNotes } from '../handleInvertNotes';
import { handleRetrogradeNotes } from '../handleRetrogradeNotes';
import { handleQuantizeNoteLengths } from '../handleQuantizeNoteLengths';
import { handleTransposeNotes } from '../handleTransposeNotes';
import { handleScaleVelocities } from '../handleScaleVelocities';
import { handleSetAllVelocities } from '../handleSetAllVelocities';
import { handleScaleAllVelocities } from '../handleScaleAllVelocities';

import {
    invertNotes,
    retrogradeNotes,
    quantizeNoteLengths,
    transposeNotes,
    scaleVelocities,
    setAllVelocities,
    scaleAllVelocities
} from '#/modules/MIDI/useCases';

vi.mock('#/modules/MIDI/useCases', () => ({
    invertNotes: vi.fn(),
    retrogradeNotes: vi.fn(),
    quantizeNoteLengths: vi.fn(),
    transposeNotes: vi.fn(),
    scaleVelocities: vi.fn(),
    setAllVelocities: vi.fn(),
    scaleAllVelocities: vi.fn(),
}));

describe('Workspace Note Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleInvertNotes should delegate to invertNotes', () => {
        handleInvertNotes.execute({ type: 'invertNotes', payload: { clipId: 'c1' } });
        expect(invertNotes).toHaveBeenCalledWith('c1');
    });

    it('handleRetrogradeNotes should delegate to retrogradeNotes', () => {
        handleRetrogradeNotes.execute({ type: 'retrogradeNotes', payload: { clipId: 'c1' } });
        expect(retrogradeNotes).toHaveBeenCalledWith('c1');
    });

    it('handleQuantizeNoteLengths should delegate to quantizeNoteLengths', () => {
        handleQuantizeNoteLengths.execute({ type: 'quantizeNoteLengths', payload: { clipId: 'c1', gridSize: 0.25 } });
        expect(quantizeNoteLengths).toHaveBeenCalledWith('c1', 0.25);
    });

    it('handleTransposeNotes should delegate to transposeNotes', () => {
        handleTransposeNotes.execute({ type: 'transposeNotes', payload: { clipId: 'c1', semitones: 2 } });
        expect(transposeNotes).toHaveBeenCalledWith('c1', 2);
    });

    it('handleScaleVelocities should delegate to scaleVelocities', () => {
        handleScaleVelocities.execute({ type: 'scaleVelocities', payload: { clipId: 'c1', curve: 'linear', minVelocity: 10, maxVelocity: 100 } });
        expect(scaleVelocities).toHaveBeenCalledWith('c1', 'linear', 10, 100);
    });

    it('handleSetAllVelocities should delegate to setAllVelocities', () => {
        handleSetAllVelocities.execute({ type: 'setAllVelocities', payload: { clipId: 'c1', velocity: 100 } });
        expect(setAllVelocities).toHaveBeenCalledWith('c1', 100);
    });

    it('handleScaleAllVelocities should delegate to scaleAllVelocities', () => {
        handleScaleAllVelocities.execute({ type: 'scaleAllVelocities', payload: { clipId: 'c1', factor: 0.8 } });
        expect(scaleAllVelocities).toHaveBeenCalledWith('c1', 0.8);
    });
});
