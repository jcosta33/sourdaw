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

    it('clears filtered-note tracking on reset() so a later legitimate Note Off is not suppressed (no hung note)', () => {
        // Regression (round 2): reset() was a no-op that deliberately KEPT
        // filteredNotes, on the theory that an orphan Note Off for a filtered
        // Note On had to stay suppressed. That theory is unfounded — a filtered
        // Note On was never forwarded downstream, so dropping its key can never
        // orphan a sounding note. Worse, a surviving stale key suppresses a
        // LATER legitimate Note Off for the same note number, hanging it:
        //
        //   1. note 40 filtered (note_min=60) → key stored, never forwarded
        //   2. reset()/panic
        //   3. user WIDENS the range (note_min=0) so note 40 now passes
        //   4. new Note On 40 forwarded to the instrument (sounding)
        //   5. its Note Off matches the STALE key and is swallowed → hung note
        //
        // reset() must clear the set so step 5's Note Off flows through.
        const filter = new NoteFilter('test-filter');
        filter.setParam('note_min', 60); // note 40 is filtered

        const onOut: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } }],
            onOut,
            transport
        );
        expect(onOut).toHaveLength(0); // filtered, never forwarded

        filter.reset();

        // Widen the range so note 40 now passes the filter.
        filter.setParam('note_min', 0);

        const onOut2: MidiEvent[] = [];
        filter.processMidi(
            [{ timeSamples: 50, kind: { type: 'noteOn', channel: 0, note: 40, velocity: 100 } }],
            onOut2,
            transport
        );
        expect(onOut2).toHaveLength(1); // now passes → forwarded → sounding on the instrument

        const offOut: MidiEvent[] = [];
        filter.processMidi([{ timeSamples: 100, kind: { type: 'noteOff', channel: 0, note: 40 } }], offOut, transport);
        expect(offOut).toHaveLength(1); // its Note Off MUST be forwarded, not suppressed by the stale key
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
