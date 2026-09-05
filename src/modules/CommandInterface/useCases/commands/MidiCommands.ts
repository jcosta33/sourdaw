import { executeUserAppAction } from '#/modules/Command/useCases';

import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getSelectedClipId } from '../selectionHelpers/getSelectedClipId';

/** MIDI commands — quantize, transpose, humanize, invert, arpeggiate. */
export const midiCommands: CallableCommandEntry[] = [
    {
        id: 'quantize-notes',
        label: 'Quantize Notes',
        description: 'Quantize MIDI notes in the selected clip to the grid',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'quantizeNotes', payload: { clipId, gridSize: 1 } });
            }
        },
    },
    {
        id: 'transpose-up',
        label: 'Transpose Up',
        description: 'Transpose notes up one semitone',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'transposeNotes', payload: { clipId, semitones: 1 } });
            }
        },
    },
    {
        id: 'transpose-down',
        label: 'Transpose Down',
        description: 'Transpose notes down one semitone',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'transposeNotes', payload: { clipId, semitones: -1 } });
            }
        },
    },
    {
        id: 'transpose-up-octave',
        label: 'Transpose Up Octave',
        description: 'Transpose notes up 12 semitones',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'transposeNotes', payload: { clipId, semitones: 12 } });
            }
        },
    },
    {
        id: 'transpose-down-octave',
        label: 'Transpose Down Octave',
        description: 'Transpose notes down 12 semitones',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'transposeNotes', payload: { clipId, semitones: -12 } });
            }
        },
    },
    {
        id: 'humanize-notes',
        label: 'Humanize Notes',
        description: 'Add subtle timing and velocity variation',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'humanizeNotes', payload: { clipId, amount: 0.3 } });
            }
        },
    },
    {
        id: 'invert-notes',
        label: 'Invert Notes',
        description: 'Mirror MIDI notes around the center pitch',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'invertNotes', payload: { clipId } });
            }
        },
    },
    {
        id: 'arpeggiate',
        label: 'Arpeggiate MIDI',
        description: 'Arpeggiate the selected MIDI clip (up/down/random patterns)',
        category: 'MIDI',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeUserAppAction({ type: 'arpeggiate', payload: { clipId } });
            }
        },
    },
    {
        id: 'clear-all-midi-mappings',
        label: 'Clear All MIDI Mappings',
        description: 'MIDI panic: remove every MIDI Learn mapping and cancel any in-progress learn',
        category: 'MIDI',
        action: { type: 'clearAllMidiMappings' },
    },
];
