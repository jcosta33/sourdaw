import { seekPlayhead } from '#/modules/Transport/useCases';

import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getLastClipEndBeat } from '../selectionHelpers/getLastClipEndBeat';
import { goToNextMarker } from '../selectionHelpers/goToNextMarker';
import { goToPreviousMarker } from '../selectionHelpers/goToPreviousMarker';

/** Transport commands — play, stop, record, loop, metronome, seek. */
export const transportCommands: CallableCommandEntry[] = [
    {
        id: 'toggle-playback',
        label: 'Play / Pause',
        description: 'Toggle transport playback',
        category: 'Transport',
        shortcut: 'Space',
        action: { type: 'togglePlayback' },
    },
    {
        id: 'stop',
        label: 'Stop',
        description: 'Stop and return to start',
        category: 'Transport',
        shortcut: 'Esc',
        action: { type: 'stopPlayback' },
    },
    {
        id: 'toggle-recording',
        label: 'Toggle Recording',
        description: 'Start or stop recording',
        category: 'Transport',
        shortcut: 'R',
        action: { type: 'toggleRecording' },
    },
    {
        id: 'toggle-loop',
        label: 'Toggle Loop',
        description: 'Enable or disable loop',
        category: 'Transport',
        shortcut: 'L',
        action: { type: 'toggleLoop' },
    },
    {
        id: 'toggle-metronome',
        label: 'Toggle Metronome',
        description: 'Enable or disable metronome',
        category: 'Transport',
        shortcut: 'M',
        action: { type: 'toggleMetronome' },
    },
    {
        id: 'go-to-start',
        label: 'Go to Start',
        description: 'Move playhead to beat 0',
        category: 'Transport',
        shortcut: 'Home',
        action: () => {
            seekPlayhead(0);
        },
    },
    {
        id: 'go-to-end',
        label: 'Go to End',
        description: 'Move playhead to last clip end',
        category: 'Transport',
        shortcut: 'End',
        action: () => {
            seekPlayhead(getLastClipEndBeat());
        },
    },
    {
        id: 'next-marker',
        label: 'Next Marker',
        description: 'Jump to the next marker',
        category: 'Transport',
        shortcut: ']',
        action: () => {
            goToNextMarker();
        },
    },
    {
        id: 'prev-marker',
        label: 'Previous Marker',
        description: 'Jump to the previous marker',
        category: 'Transport',
        shortcut: '[',
        action: () => {
            goToPreviousMarker();
        },
    },
];
