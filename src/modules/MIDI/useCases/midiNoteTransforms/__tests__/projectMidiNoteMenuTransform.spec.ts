import { describe, expect, it } from 'vitest';

import { projectMidiNoteMenuTransform } from '../projectMidiNoteMenuTransform';

describe('projectMidiNoteMenuTransform', () => {
    it('re-cuts performed expression when quantizing length without changing the source row', () => {
        const original = {
            id: 'recorded',
            pitch: 60,
            startBeat: 0.5,
            duration: 1.2,
            velocity: 90,
            pressure: 12,
            recordingPassIndex: 2,
            expression: { pressure: [{ offsetBeats: 1.1, value: 80 }] },
        };
        const result = projectMidiNoteMenuTransform([original], { kind: 'quantize-length', gridSize: 1 });
        expect(result[0]).toEqual(expect.objectContaining({ duration: 1, recordingPassIndex: 2, pressure: 12 }));
        expect(result[0]).not.toHaveProperty('expression');
        expect(original.expression.pressure).toEqual([{ offsetBeats: 1.1, value: 80 }]);
    });
});
