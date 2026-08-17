import { describe, expect, it } from 'vitest';

import { type MidiEvent } from '../../models/MidiEvent';
import { ScheduledEventQueue } from '../MidiProcessor';

function noteOn(
    trackId: string,
    channel: number,
    note: number,
    timeSamples: number,
    noteInstanceId?: string
): MidiEvent {
    return { timeSamples, trackId, noteInstanceId, kind: { type: 'noteOn', channel, note, velocity: 100 } };
}
function noteOff(
    trackId: string,
    channel: number,
    note: number,
    timeSamples: number,
    noteInstanceId?: string
): MidiEvent {
    return { timeSamples, trackId, noteInstanceId, kind: { type: 'noteOff', channel, note } };
}

describe('ScheduledEventQueue', () => {
    describe('push / size', () => {
        it('counts only queued events', () => {
            const queue = new ScheduledEventQueue();
            expect(queue.size).toBe(0);
            queue.push(noteOn('t1', 0, 60, 100));
            queue.push(noteOff('t1', 0, 60, 200));
            expect(queue.size).toBe(2);
        });
    });

    describe('drainRangeInto', () => {
        it('returns events inside [start, end) sorted by time and leaves the rest', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOn('t1', 0, 60, 300)); // outside window
            queue.push(noteOn('t1', 0, 62, 100)); // inside
            queue.push(noteOn('t1', 0, 64, 50)); // inside (earlier — must sort first)

            const drained = queue.drainRangeInto(0, 200, [], 't1');
            expect(drained.map((event) => event.timeSamples)).toEqual([50, 100]);
            // The event at 300 stays queued.
            expect(queue.size).toBe(1);
        });

        it('scopes draining to the requested trackId', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOn('t1', 0, 60, 100));
            queue.push(noteOn('t2', 0, 60, 100));
            const drained = queue.drainRangeInto(0, 200, [], 't1');
            expect(drained).toHaveLength(1);
            expect(drained[0]?.trackId).toBe('t1');
            // The other track's event survives.
            expect(queue.size).toBe(1);
        });

        it('drainRangeInto partitions in place into the supplied out array', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOn('t1', 0, 64, 50));
            queue.push(noteOn('t1', 0, 60, 300));
            queue.push(noteOn('t1', 0, 62, 100));
            const out: MidiEvent[] = [];
            const result = queue.drainRangeInto(0, 200, out, 't1');
            expect(result).toBe(out);
            expect(out.map((event) => event.timeSamples)).toEqual([50, 100]);
            expect(queue.size).toBe(1);
        });
    });

    describe('flushAllNotesOff', () => {
        it('emits one Note Off per distinct (track, channel, note) Note On', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOn('t1', 0, 60, 100));
            queue.push(noteOn('t1', 0, 64, 100));
            queue.push(noteOn('t1', 1, 67, 100)); // different channel → distinct

            const out: MidiEvent[] = [];
            queue.flushAllNotesOff(out, 999);

            expect(out).toHaveLength(3);
            expect(out.every((event) => event.kind.type === 'noteOff')).toBe(true);
            expect(out.every((event) => event.timeSamples === 999)).toBe(true);
            expect(out.map((event) => (event.kind as { note: number }).note).sort((a, b) => a - b)).toEqual([
                60, 64, 67,
            ]);
            // All queued events are consumed.
            expect(queue.size).toBe(0);
        });

        it('de-duplicates re-triggers of the same (channel, note) within a track', () => {
            const queue = new ScheduledEventQueue();
            // Two scheduled Note Ons for the exact same (track=t1, channel=0, note=60)
            // represent a re-trigger. A flush must kill that voice once, not twice,
            // so the synth sees a single release.
            queue.push(noteOn('t1', 0, 60, 100, 'a'));
            queue.push(noteOn('t1', 0, 60, 200, 'b'));
            queue.push(noteOn('t1', 0, 64, 100, 'c')); // different note → its own off

            const out: MidiEvent[] = [];
            queue.flushAllNotesOff(out, 0);

            const offs = out.filter((event) => event.kind.type === 'noteOff');
            expect(offs).toHaveLength(2);
            expect(offs.map((event) => (event.kind as { note: number }).note).sort((a, b) => a - b)).toEqual([60, 64]);
        });

        it('keeps per-track dedup independent across tracks', () => {
            // The same (channel, note) on two different tracks must each get an off;
            // dedup is scoped per track so one track's release does not suppress
            // another track's release for the same pitch.
            const queue = new ScheduledEventQueue();
            queue.push(noteOn('t1', 0, 60, 100));
            queue.push(noteOn('t2', 0, 60, 100));

            const out: MidiEvent[] = [];
            queue.flushAllNotesOff(out, 0);

            expect(out).toHaveLength(2);
            expect(out.map((event) => event.trackId).sort()).toEqual(['t1', 't2']);
        });

        it('skips queued Note Offs and Note Ons without a trackId', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOff('t1', 0, 60, 100)); // already an off — skipped
            queue.push({ ...noteOn('t1', 0, 64, 100), trackId: undefined }); // no track → skipped
            queue.push(noteOn('t1', 0, 67, 100)); // qualifies

            const out: MidiEvent[] = [];
            queue.flushAllNotesOff(out, 0);

            expect(out).toHaveLength(1);
            expect((out[0]!.kind as { note: number }).note).toBe(67);
        });
    });

    describe('removeNoteOn / removeNoteOff', () => {
        it('removes the one Note On matching the exact identity and returns true', () => {
            const queue = new ScheduledEventQueue();
            const on = noteOn('t1', 0, 60, 100, 'inst-1');
            queue.push(on);
            queue.push(noteOff('t1', 0, 60, 200, 'inst-1'));

            expect(queue.removeNoteOn('t1', 0, 60, 100, 'inst-1')).toBe(true);
            expect(queue.size).toBe(1);
            // Remaining event is the off.
            expect(queue.drainRangeInto(0, 1000, [], 't1')[0]?.kind.type).toBe('noteOff');
        });

        it('removes a Note Off endpoint regardless of noteInstanceId when none is given', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOff('t1', 0, 60, 200, 'inst-1'));
            expect(queue.removeNoteOff('t1', 0, 60, 200)).toBe(true);
            expect(queue.size).toBe(0);
        });

        it('returns false when no endpoint matches', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOn('t1', 0, 60, 100, 'inst-1'));
            // Mismatched noteInstanceId → not the one we asked for.
            expect(queue.removeNoteOn('t1', 0, 60, 100, 'inst-other')).toBe(false);
            // Mismatched time → not a match.
            expect(queue.removeNoteOff('t1', 0, 60, 999)).toBe(false);
            expect(queue.size).toBe(1);
        });
    });

    describe('clear', () => {
        it('drops every queued event', () => {
            const queue = new ScheduledEventQueue();
            queue.push(noteOn('t1', 0, 60, 100));
            queue.push(noteOff('t1', 0, 60, 200));
            queue.clear();
            expect(queue.size).toBe(0);
        });
    });
});
