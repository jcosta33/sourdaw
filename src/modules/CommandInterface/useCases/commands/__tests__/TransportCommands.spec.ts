import { beforeEach, describe, expect, it, vi } from 'vitest';

import { panicAllNotes, seekPlayhead } from '#/modules/Transport/useCases';

import { getLastClipEndBeat } from '../../selectionHelpers/getLastClipEndBeat';
import { goToNextMarker } from '../../selectionHelpers/goToNextMarker';
import { goToPreviousMarker } from '../../selectionHelpers/goToPreviousMarker';
import { transportCommands } from '../TransportCommands';

vi.mock('#/modules/Transport/useCases', () => ({
    seekPlayhead: vi.fn(),
    panicAllNotes: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../selectionHelpers/getLastClipEndBeat', () => ({ getLastClipEndBeat: vi.fn().mockReturnValue(0) }));
vi.mock('../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: vi.fn() }));
vi.mock('../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: vi.fn() }));

function runAction(id: string): void {
    const command = transportCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('transportCommands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exposes the transport commands under the Transport category', () => {
        expect(
            transportCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))
        ).toEqual([
            { id: 'toggle-playback', label: 'Play / Pause', category: 'Transport' },
            { id: 'stop', label: 'Stop', category: 'Transport' },
            { id: 'toggle-recording', label: 'Toggle Recording', category: 'Transport' },
            { id: 'toggle-loop', label: 'Toggle Loop', category: 'Transport' },
            { id: 'toggle-metronome', label: 'Toggle Metronome', category: 'Transport' },
            { id: 'go-to-start', label: 'Go to Start', category: 'Transport' },
            { id: 'go-to-end', label: 'Go to End', category: 'Transport' },
            { id: 'next-marker', label: 'Next Marker', category: 'Transport' },
            { id: 'prev-marker', label: 'Previous Marker', category: 'Transport' },
            { id: 'panic-all-notes', label: 'MIDI Panic — All Notes Off', category: 'Transport' },
        ]);
    });

    // audit MD-6 — the panic needs a surface a user can actually reach.
    it('panic-all-notes invokes the transport panic', () => {
        runAction('panic-all-notes');

        expect(panicAllNotes).toHaveBeenCalledTimes(1);
    });

    it('toggle-playback, stop, toggle-recording, toggle-loop, and toggle-metronome are declarative transport actions', () => {
        const staticEntries = [
            { id: 'toggle-playback', action: { type: 'togglePlayback' } },
            { id: 'stop', action: { type: 'stopPlayback' } },
            { id: 'toggle-recording', action: { type: 'toggleRecording' } },
            { id: 'toggle-loop', action: { type: 'toggleLoop' } },
            { id: 'toggle-metronome', action: { type: 'toggleMetronome' } },
        ];

        for (const { id, action } of staticEntries) {
            const command = transportCommands.find((entry) => entry.id === id);
            expect(command?.action).toEqual(action);
        }
    });

    it('go-to-start seeks the playhead to beat 0', () => {
        runAction('go-to-start');

        expect(seekPlayhead).toHaveBeenCalledWith(0);
    });

    it('go-to-end seeks the playhead to the last clip end beat', () => {
        vi.mocked(getLastClipEndBeat).mockReturnValue(42);

        runAction('go-to-end');

        expect(seekPlayhead).toHaveBeenCalledWith(42);
    });

    it('next-marker jumps to the next marker', () => {
        runAction('next-marker');

        expect(goToNextMarker).toHaveBeenCalledTimes(1);
    });

    it('prev-marker jumps to the previous marker', () => {
        runAction('prev-marker');

        expect(goToPreviousMarker).toHaveBeenCalledTimes(1);
    });
});
