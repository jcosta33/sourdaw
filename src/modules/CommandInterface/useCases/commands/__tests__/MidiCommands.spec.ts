import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeUserAppAction } from '#/modules/Command/useCases';

import { midiCommands } from '../MidiCommands';

vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: vi.fn() }));

const CLIP_SCOPED_COMMAND_IDS = [
    'quantize-notes',
    'transpose-up',
    'transpose-down',
    'transpose-up-octave',
    'transpose-down-octave',
    'humanize-notes',
    'invert-notes',
    'arpeggiate',
];

function runAction(id: string): void {
    const command = midiCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('midiCommands', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue('clip-1');
    });

    it('exposes the MIDI editing commands under the MIDI category', () => {
        expect(midiCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))).toEqual([
            { id: 'quantize-notes', label: 'Quantize Notes', category: 'MIDI' },
            { id: 'transpose-up', label: 'Transpose Up', category: 'MIDI' },
            { id: 'transpose-down', label: 'Transpose Down', category: 'MIDI' },
            { id: 'transpose-up-octave', label: 'Transpose Up Octave', category: 'MIDI' },
            { id: 'transpose-down-octave', label: 'Transpose Down Octave', category: 'MIDI' },
            { id: 'humanize-notes', label: 'Humanize Notes', category: 'MIDI' },
            { id: 'invert-notes', label: 'Invert Notes', category: 'MIDI' },
            { id: 'arpeggiate', label: 'Arpeggiate MIDI', category: 'MIDI' },
            { id: 'clear-all-midi-mappings', label: 'Clear All MIDI Mappings', category: 'MIDI' },
        ]);
    });

    it('quantize-notes dispatches quantizeNotes with the selected clip and a quarter-beat grid', () => {
        runAction('quantize-notes');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'quantizeNotes',
            payload: { clipId: 'clip-1', gridSize: 1 },
        });
    });

    it('transpose-up dispatches transposeNotes one semitone up', () => {
        runAction('transpose-up');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'transposeNotes',
            payload: { clipId: 'clip-1', semitones: 1 },
        });
    });

    it('transpose-down dispatches transposeNotes one semitone down', () => {
        runAction('transpose-down');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'transposeNotes',
            payload: { clipId: 'clip-1', semitones: -1 },
        });
    });

    it('transpose-up-octave dispatches transposeNotes twelve semitones up', () => {
        runAction('transpose-up-octave');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'transposeNotes',
            payload: { clipId: 'clip-1', semitones: 12 },
        });
    });

    it('transpose-down-octave dispatches transposeNotes twelve semitones down', () => {
        runAction('transpose-down-octave');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'transposeNotes',
            payload: { clipId: 'clip-1', semitones: -12 },
        });
    });

    it('humanize-notes dispatches humanizeNotes with a subtle 0.3 amount', () => {
        runAction('humanize-notes');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'humanizeNotes',
            payload: { clipId: 'clip-1', amount: 0.3 },
        });
    });

    it('invert-notes dispatches invertNotes for the selected clip', () => {
        runAction('invert-notes');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'invertNotes',
            payload: { clipId: 'clip-1' },
        });
    });

    it('arpeggiate dispatches arpeggiate for the selected clip', () => {
        runAction('arpeggiate');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'arpeggiate',
            payload: { clipId: 'clip-1' },
        });
    });

    it('clear-all-midi-mappings is a declarative action, not a callable, and carries no payload', () => {
        const command = midiCommands.find((entry) => entry.id === 'clear-all-midi-mappings');

        expect(command?.action).toEqual({ type: 'clearAllMidiMappings' });
    });

    it('dispatches nothing for any clip-scoped command when no clip is selected', async () => {
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue(null);

        for (const id of CLIP_SCOPED_COMMAND_IDS) {
            runAction(id);
        }

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });
});
