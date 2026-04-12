import { describe, it, expect } from 'vitest';
import { describeAction, ACTION_LABELS } from '../actionLabels';
import { type AppAction } from '../commandQueries';

describe('actionLabels', () => {
    it('should cover common action types used in the label map', () => {
        expect(ACTION_LABELS.addTrack).toBe('Add track');
        expect(ACTION_LABELS.setTempo).toBe('Set tempo');
        expect(ACTION_LABELS.quantizeNotes).toBe('Quantize');
    });

    it('should describe actions without payload using the base label', () => {
        expect(describeAction({ type: 'togglePlayback' })).toBe('Play/pause');
        expect(describeAction({ type: 'toggleMetronome' })).toBe('toggleMetronome');
    });

    it('should append track or clip names when payload has name', () => {
        expect(
            describeAction({
                type: 'addTrack',
                payload: { name: 'Drums', kind: 'audio' },
            })
        ).toBe('Add track: Drums');
        expect(
            describeAction({
                type: 'renameTrack',
                payload: { trackId: 't1', name: 'Vox' },
            })
        ).toBe('Rename track: Vox');
    });

    it('should format tempo with BPM', () => {
        expect(describeAction({ type: 'setTempo', payload: { bpm: 132 } })).toBe('Set tempo: 132 BPM');
    });

    it('should format gain as a percentage using the action type when no label exists', () => {
        expect(describeAction({ type: 'setMasterGain', payload: { gain: 0.5 } })).toBe('setMasterGain: 50%');
    });

    it('should format device parameters', () => {
        expect(
            describeAction({
                type: 'setDeviceParameter',
                payload: { deviceId: 'd1', paramId: 'cutoff', value: 0.7 },
            })
        ).toBe('Set parameter: cutoff = 0.7');
    });

    it('should format transpose with signed semitones', () => {
        expect(
            describeAction({
                type: 'transposeNotes',
                payload: { clipId: 'c1', semitones: -3 },
            })
        ).toBe('Transpose: -3st');
        expect(
            describeAction({
                type: 'transposeNotes',
                payload: { clipId: 'c1', semitones: 5 },
            })
        ).toBe('Transpose: +5st');
    });

    it('should append device type for addDevice', () => {
        expect(
            describeAction({
                type: 'addDevice',
                payload: { trackId: 't1', deviceType: 'Granular' },
            })
        ).toBe('Add device: Granular');
    });

    it('should include payload kind when no name branch matches', () => {
        expect(
            describeAction({
                type: 'togglePlayback',
                payload: { kind: 'aux' },
            } as AppAction)
        ).toBe('Play/pause (aux)');
    });

    it('should append tool for setEditingTool', () => {
        expect(
            describeAction({
                type: 'setEditingTool',
                payload: { tool: 'slice' },
            })
        ).toBe('Set tool: slice');
    });

    it('should fall back to raw action type when no label is registered', () => {
        const unknown = { type: 'nonexistentActionType', payload: { foo: 1 } } as unknown as AppAction;
        expect(describeAction(unknown)).toBe('nonexistentActionType');
    });
});
