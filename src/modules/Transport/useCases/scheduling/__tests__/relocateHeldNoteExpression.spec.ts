import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startNoteExpression } from '#/modules/AudioEngine/useCases';

import { detachSoundingNoteExpression } from '../detachSoundingNoteExpression';
import { forgetHeldNoteExpression } from '../forgetHeldNoteExpression';
import { heldNotesByTrack, type HeldNote } from '../heldNoteExpressionState';
import { holdNoteExpression } from '../holdNoteExpression';
import { relocateHeldNoteExpression } from '../relocateHeldNoteExpression';

// The engine's own timelines are the contract under test with the registry: what a relocation carries is
// what the engine's relocation makes of the timeline a note started with.
vi.mock('#/modules/AudioEngine/useCases', async () => ({
    startNoteExpression: (
        await vi.importActual<Pick<typeof import('#/modules/AudioEngine/useCases'), 'startNoteExpression'>>(
            '#/modules/AudioEngine/useCases/noteExpression/startNoteExpression'
        )
    ).startNoteExpression,
    relocateNoteExpression: (
        await vi.importActual<Pick<typeof import('#/modules/AudioEngine/useCases'), 'relocateNoteExpression'>>(
            '#/modules/AudioEngine/useCases/noteExpression/relocateNoteExpression'
        )
    ).relocateNoteExpression,
}));

const frameAtBeat = (beat: number) => beat * 1000;
/** The relocated window opens on frame 50 000, where its beat 0 lands. */
const AT_FRAME = 50_000;
const newPassFrameAtBeat = (beat: number) => AT_FRAME + beat * 1000;
const newPassBeatAtFrame = (frame: number) => (frame - AT_FRAME) / 1000;

/** A note struck under a full bend, released at frame 80 000: 30 beats of the new pass from now. */
function ringingNote(overrides: Partial<HeldNote> = {}): HeldNote {
    const { timeline } = startNoteExpression({
        note: { pressure: 10 },
        channelBend: [
            { beat: 0, frame: 0, recordedBeat: 0, value: 8191, rangeSemitones: 2, channel: 0, zoneWide: false },
        ],
        startBeat: 0,
        releaseFrame: 80_000,
        frameAtBeat,
    });
    return {
        pitch: 64,
        channel: 2,
        receiverId: 'device-1',
        releaseBeat: 80,
        followsChannelBend: true,
        timeline,
        ...overrides,
    };
}

function hold(note: HeldNote, trackId = 'track-1'): void {
    holdNoteExpression({ trackId, ...note });
}

function relocate(
    notes: readonly HeldNote[],
    overrides: Partial<Parameters<typeof relocateHeldNoteExpression>[0]> = {}
) {
    return relocateHeldNoteExpression({
        trackId: 'track-1',
        notes,
        receiverId: 'device-1',
        atFrame: AT_FRAME,
        frameAtBeat: newPassFrameAtBeat,
        beatAtFrame: newPassBeatAtFrame,
        readChannelBend: () => [],
        ...overrides,
    });
}

beforeEach(() => {
    forgetHeldNoteExpression();
});

describe('detachSoundingNoteExpression', () => {
    it('hands back the notes that follow the channel bend by track and empties the registry', () => {
        hold(ringingNote({ pitch: 60 }), 'track-1');
        hold(ringingNote({ pitch: 62 }), 'track-1');
        hold(ringingNote({ pitch: 64 }), 'track-2');

        const sounding = detachSoundingNoteExpression();

        expect([...sounding.keys()]).toEqual(['track-1', 'track-2']);
        expect(sounding.get('track-1')?.map((note) => note.pitch)).toEqual([60, 62]);
        expect(sounding.get('track-2')?.map((note) => note.pitch)).toEqual([64]);
        expect(heldNotesByTrack.size).toBe(0);
    });

    it('leaves behind a note that has only its own curve points to move', () => {
        hold(ringingNote({ pitch: 60, followsChannelBend: false }));
        hold(ringingNote({ pitch: 62 }));

        const sounding = detachSoundingNoteExpression();

        expect(sounding.get('track-1')?.map((note) => note.pitch)).toEqual([62]);
        expect(heldNotesByTrack.size).toBe(0);
    });

    it('hands back nothing for a track none of whose notes follow the channel bend', () => {
        hold(ringingNote({ followsChannelBend: false }));

        expect(detachSoundingNoteExpression().size).toBe(0);
    });
});

describe('relocateHeldNoteExpression', () => {
    it('carries a sounding note into the new pass and returns it to centre when no bend is in force there', () => {
        const due = relocate([ringingNote()]);

        expect(due).toEqual([
            { pitch: 64, channel: 2, expression: { pressure: 10, pitchBend: 0, pitchBendRangeSemitones: 2 } },
        ]);
    });

    it('holds the carried note again, on the new clock, with its release in the new pass’s beats', () => {
        relocate([ringingNote()]);

        const [carried] = heldNotesByTrack.get('track-1') ?? [];
        expect(carried).toMatchObject({ pitch: 64, channel: 2, receiverId: 'device-1', followsChannelBend: true });
        expect(carried?.releaseBeat).toBe(30);
        expect(carried?.timeline.frameAtBeat(3)).toBe(53_000);
        expect(carried?.timeline.releaseFrame).toBe(80_000);
    });

    it('returns nothing for a note that already holds the bend in force at the destination', () => {
        const due = relocate([ringingNote()], {
            readChannelBend: () => [
                {
                    beat: 0,
                    frame: AT_FRAME,
                    recordedBeat: 0,
                    value: 8191,
                    rangeSemitones: 2,
                    channel: 0,
                    zoneWide: false,
                },
            ],
        });

        expect(due).toEqual([]);
        expect(heldNotesByTrack.get('track-1')).toHaveLength(1);
    });

    it('keeps a note released a frame after the window opens, and drops one released on it or before', () => {
        const afterNote = ringingNote({ pitch: 60 });
        const onNote = ringingNote({ pitch: 62 });
        const beforeNote = ringingNote({ pitch: 64 });

        relocate([
            { ...afterNote, timeline: { ...afterNote.timeline, releaseFrame: AT_FRAME + 1 } },
            { ...onNote, timeline: { ...onNote.timeline, releaseFrame: AT_FRAME } },
            { ...beforeNote, timeline: { ...beforeNote.timeline, releaseFrame: AT_FRAME - 1 } },
        ]);

        expect(heldNotesByTrack.get('track-1')?.map((note) => note.pitch)).toEqual([60]);
    });

    it('drops a note the track’s instrument does not voice now', () => {
        const due = relocate([ringingNote({ receiverId: 'device-1' })], { receiverId: 'device-2' });

        expect(due).toEqual([]);
        expect(heldNotesByTrack.size).toBe(0);
    });

    it('drops every note when the track’s instrument is bypassed', () => {
        const due = relocate([ringingNote({ receiverId: undefined })], { receiverId: undefined });

        expect(due).toEqual([]);
        expect(heldNotesByTrack.size).toBe(0);
    });

    it('reads the channel bend once for the notes it carries, and not at all when none is carried', () => {
        const readChannelBend = vi.fn(() => []);

        relocate([ringingNote({ pitch: 60 }), ringingNote({ pitch: 62 })], { readChannelBend });
        expect(readChannelBend).toHaveBeenCalledTimes(1);

        readChannelBend.mockClear();
        forgetHeldNoteExpression();
        relocate([ringingNote({ receiverId: 'device-2' })], { readChannelBend });
        expect(readChannelBend).not.toHaveBeenCalled();
    });

    it('addresses each carried note by its own pitch and channel', () => {
        const due = relocate([ringingNote({ pitch: 60, channel: 1 }), ringingNote({ pitch: 62, channel: 3 })]);

        expect(due.map(({ pitch, channel }) => [pitch, channel])).toEqual([
            [60, 1],
            [62, 3],
        ]);
    });
});
