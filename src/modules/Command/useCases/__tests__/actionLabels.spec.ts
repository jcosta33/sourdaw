import { describe, it, expect } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { describeAction, ACTION_LABELS } from '../actionLabels';

describe('actionLabels', () => {
    it('should cover common action types used in the label map', () => {
        expect(ACTION_LABELS.addTrack).toBe('Add track');
        expect(ACTION_LABELS.setTempo).toBe('Set tempo');
        expect(ACTION_LABELS.quantizeNotes).toBe('Quantize');
    });

    it('should describe actions without payload using the base label', () => {
        expect(describeAction({ type: 'togglePlayback' })).toBe('Play/pause');
        // Not in ACTION_LABELS → humanized, never the raw camelCase enum string.
        expect(describeAction({ type: 'toggleMetronome' })).toBe('Toggle metronome');
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

    it('should format gain as a percentage using a humanized base when no label exists', () => {
        // `setMasterGain` is not in ACTION_LABELS; the base must be humanized
        // ("Set master gain"), never the raw enum string.
        expect(describeAction({ type: 'setMasterGain', payload: { gain: 0.5 } })).toBe('Set master gain: 50%');
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
        // Off-contract payload: no AppAction member pairs `kind` without `name`,
        // but persisted/legacy actions can carry drifted payload shapes, and the
        // kind branch must still render them.
        const offContractAction: { type: AppAction['type']; payload?: unknown } = {
            type: 'togglePlayback',
            payload: { kind: 'aux' },
        };
        expect(describeAction(offContractAction as AppAction)).toBe('Play/pause (aux)');
    });

    it('should append tool for setEditingTool', () => {
        expect(
            describeAction({
                type: 'setEditingTool',
                payload: { tool: 'slice' },
            })
        ).toBe('Set tool: slice');
    });

    it('should humanize (never leak) an unlabeled action type', () => {
        const unknown = { type: 'nonexistentActionType', payload: { foo: 1 } } as unknown as AppAction;
        expect(describeAction(unknown)).toBe('Nonexistent action type');
    });

    it('should never return the raw camelCase enum string for unlabeled actions', () => {
        // Sample of action types deliberately absent from ACTION_LABELS that
        // previously leaked their raw enum string into PromptBar/history.
        const unlabeled = [
            { type: 'freezeTrack', expected: 'Freeze track' },
            { type: 'setMasterGain', expected: 'Set master gain' },
            { type: 'audioToMidi', expected: 'Audio to MIDI' },
            { type: 'enableMpe', expected: 'Enable MPE' },
            { type: 'assignToVca', expected: 'Assign to VCA' },
            { type: 'loadRaveModel', expected: 'Load RAVE model' },
            { type: 'restoreDsoSnapshot', expected: 'Restore DSO snapshot' },
            { type: 'elasticSetTool', expected: 'Elastic set tool' },
            { type: 'duplicateClipToNextBar', expected: 'Duplicate clip to next bar' },
        ] as const;
        for (const { type, expected } of unlabeled) {
            const label = describeAction({ type } as unknown as AppAction);
            expect(label).toBe(expected);
            // The defining property of the fix: the raw enum string never surfaces.
            expect(label).not.toBe(type);
        }
    });
});
