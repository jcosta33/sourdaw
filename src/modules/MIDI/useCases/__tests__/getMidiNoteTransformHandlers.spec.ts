import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    batchAddMidiNotes: vi.fn(),
    humanizeNotes: vi.fn(),
    invertNotes: vi.fn(),
    quantizeNoteLengths: vi.fn(),
    quantizeNotes: vi.fn(),
    retrogradeNotes: vi.fn(),
    scaleAllVelocities: vi.fn(),
    scaleVelocities: vi.fn(),
    setAllVelocities: vi.fn(),
    transposeNotes: vi.fn(),
}));

vi.mock('../midiNoteCrud/batchAddMidiNotes', () => ({ batchAddMidiNotes: mocks.batchAddMidiNotes }));
vi.mock('../midiNoteTransforms/humanizeNotes', () => ({ humanizeNotes: mocks.humanizeNotes }));
vi.mock('../midiNoteTransforms/invertNotes', () => ({ invertNotes: mocks.invertNotes }));
vi.mock('../midiNoteTransforms/quantizeNoteLengths', () => ({ quantizeNoteLengths: mocks.quantizeNoteLengths }));
vi.mock('../midiNoteTransforms/quantizeNotes', () => ({ quantizeNotes: mocks.quantizeNotes }));
vi.mock('../midiNoteTransforms/retrogradeNotes', () => ({ retrogradeNotes: mocks.retrogradeNotes }));
vi.mock('../midiNoteTransforms/scaleAllVelocities', () => ({ scaleAllVelocities: mocks.scaleAllVelocities }));
vi.mock('../midiNoteTransforms/scaleVelocities', () => ({ scaleVelocities: mocks.scaleVelocities }));
vi.mock('../midiNoteTransforms/setAllVelocities', () => ({ setAllVelocities: mocks.setAllVelocities }));
vi.mock('../midiNoteTransforms/transposeNotes', () => ({ transposeNotes: mocks.transposeNotes }));

import { getMidiNoteTransformHandlers } from '../getMidiNoteTransformHandlers';

describe('getMidiNoteTransformHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should expose MIDI-owned note transform action handlers', () => {
        const handlers = getMidiNoteTransformHandlers();

        expect(Object.keys(handlers).sort()).toEqual([
            'addNotes',
            'humanizeNotes',
            'invertNotes',
            'quantizeNoteLengths',
            'quantizeNotes',
            'restoreMidiClipNotes',
            'retrogradeNotes',
            'scaleAllVelocities',
            'scaleVelocities',
            'setAllVelocities',
            'transposeNotes',
        ]);
    });

    it('should delegate note transform actions to MIDI use cases', () => {
        const handlers = getMidiNoteTransformHandlers();

        void handlers.addNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'clip1', notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        });
        void handlers.transposeNotes.execute({ type: 'transposeNotes', payload: { clipId: 'clip1', semitones: 2 } });
        void handlers.humanizeNotes.execute({ type: 'humanizeNotes', payload: { clipId: 'clip1', amount: 0.25 } });
        void handlers.invertNotes.execute({ type: 'invertNotes', payload: { clipId: 'clip1' } });
        void handlers.retrogradeNotes.execute({ type: 'retrogradeNotes', payload: { clipId: 'clip1' } });
        void handlers.quantizeNoteLengths.execute({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'clip1', gridSize: 0.25 },
        });
        void handlers.quantizeNotes.execute({
            type: 'quantizeNotes',
            payload: { clipId: 'clip1', gridSize: 0.25, strength: 0.5, swing: 0.1 },
        });
        void handlers.scaleVelocities.execute({
            type: 'scaleVelocities',
            payload: { clipId: 'clip1', curve: 'linear', minVelocity: 10, maxVelocity: 100 },
        });
        void handlers.scaleAllVelocities.execute({
            type: 'scaleAllVelocities',
            payload: { clipId: 'clip1', factor: 0.8 },
        });
        void handlers.setAllVelocities.execute({
            type: 'setAllVelocities',
            payload: { clipId: 'clip1', velocity: 90 },
        });

        expect(mocks.batchAddMidiNotes).toHaveBeenCalledWith('clip1', [
            { pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
        ]);
        expect(mocks.transposeNotes).toHaveBeenCalledWith('clip1', 2);
        // The handler forwards optional velocityAmount + seed (both absent on a
        // first execute) so it can capture the returned seed for deterministic redo.
        expect(mocks.humanizeNotes).toHaveBeenCalledWith('clip1', 0.25, undefined, undefined);
        expect(mocks.invertNotes).toHaveBeenCalledWith('clip1');
        expect(mocks.retrogradeNotes).toHaveBeenCalledWith('clip1');
        expect(mocks.quantizeNoteLengths).toHaveBeenCalledWith('clip1', 0.25);
        expect(mocks.quantizeNotes).toHaveBeenCalledWith('clip1', 0.25, 0.5, 0.1);
        expect(mocks.scaleVelocities).toHaveBeenCalledWith('clip1', 'linear', 10, 100);
        expect(mocks.scaleAllVelocities).toHaveBeenCalledWith('clip1', 0.8);
        expect(mocks.setAllVelocities).toHaveBeenCalledWith('clip1', 90);
    });
});
