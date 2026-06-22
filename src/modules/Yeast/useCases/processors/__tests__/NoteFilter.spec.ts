import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { NoteFilter } from '../NoteFilter';

const transport: TransportInfo = {
    sampleRate: 44100,
    bpm: 120,
    ppqPosition: 0,
    isPlaying: true,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

describe('NoteFilter', () => {
    it('should export NoteFilter', () => {
        expect(NoteFilter).toBeDefined();
        const time = typeof NoteFilter;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('suppresses the Note Off for a filtered Note On', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60); // note 40 is below the range → filtered

        const onOut: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } }],
            onOut,
            transport
        );
        expect(onOut).toHaveLength(0); // Note On was filtered

        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 100, kind: { type: 'noteOff', channel: 0, note: 40 } }], offOut, transport);
        expect(offOut).toHaveLength(0); // matching Note Off suppressed
    });

    it('does not leak a Note Off for a filtered Note On after reset()', () => {
        // Regression: reset() used to clear filteredNotes, so a Note Off arriving
        // after reset for a note whose Note On was filtered no longer matched the
        // set and leaked downstream — a stray Note Off for a note never played.
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60);

        const onOut: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } }],
            onOut,
            transport
        );
        expect(onOut).toHaveLength(0);

        filter.reset();

        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 100, kind: { type: 'noteOff', channel: 0, note: 40 } }], offOut, transport);
        expect(offOut).toHaveLength(0); // still suppressed after reset — no stray Note Off
    });

    it('still forwards a Note Off for a note that passed the filter', () => {
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60);

        const onOut: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 72, velocity: 100 } }],
            onOut,
            transport
        );
        expect(onOut).toHaveLength(1); // passed

        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 100, kind: { type: 'noteOff', channel: 0, note: 72 } }], offOut, transport);
        expect(offOut).toHaveLength(1); // its Note Off is forwarded
    });
});
