import { describe, expect, it } from 'vitest';

import { selectMidiClipsForSchedulerWindow } from '../selectMidiClipsForSchedulerWindow';

type ScheduledTrackClip = Parameters<typeof selectMidiClipsForSchedulerWindow>[0]['clips'][number];

function midiClip(
    id: string,
    startBeat: number,
    endBeat: number,
    overrides: Partial<ScheduledTrackClip> = {}
): ScheduledTrackClip {
    return {
        id,
        trackId: 'track-1',
        name: id,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('selectMidiClipsForSchedulerWindow', () => {
    it('selects overlapping intervals and restores persisted clip order', () => {
        const clips = [
            midiClip('starts-in-window', 10.5, 11),
            midiClip('ends-at-window-start', 8, 10),
            midiClip('long-overlap', 0, 100),
            midiClip('starts-at-window-end', 11, 12),
        ];

        expect(selectMidiClipsForSchedulerWindow({ clips, fromBeat: 10, toBeat: 11 }).map((clip) => clip.id)).toEqual([
            'starts-in-window',
            'long-overlap',
        ]);
    });

    it('excludes muted MIDI clips and audio clips when the index is built', () => {
        const clips = [
            midiClip('active', 0, 4),
            midiClip('muted', 0, 4, { muted: true }),
            midiClip('audio', 0, 4, { type: 'audio', audioBufferId: 'buffer-1' }),
        ];

        expect(selectMidiClipsForSchedulerWindow({ clips, fromBeat: 1, toBeat: 2 })).toEqual([clips[0]]);
    });

    it('reuses the interval index without scanning project-wide geometry', () => {
        let geometryReads = 0;
        const clips = Array.from({ length: 2_048 }, (_, index) => {
            const startBeat = index * 2;
            const clip = midiClip(`clip-${index}`, startBeat, startBeat + 1);
            Object.defineProperties(clip, {
                startBeat: {
                    enumerable: true,
                    get: () => {
                        geometryReads++;
                        return startBeat;
                    },
                },
                endBeat: {
                    enumerable: true,
                    get: () => {
                        geometryReads++;
                        return startBeat + 1;
                    },
                },
            });
            return clip;
        });

        selectMidiClipsForSchedulerWindow({ clips, fromBeat: 2_048, toBeat: 2_049 });
        geometryReads = 0;

        expect(selectMidiClipsForSchedulerWindow({ clips, fromBeat: 2_048, toBeat: 2_049 })).toEqual([clips[1_024]]);
        expect(geometryReads).toBeLessThan(100);
    });

    it('rebuilds the interval index when a project write replaces the clips array', () => {
        const original = [midiClip('clip', 4, 5)];
        const replacement = [{ ...original[0]!, startBeat: 1, endBeat: 2 }];

        expect(selectMidiClipsForSchedulerWindow({ clips: original, fromBeat: 1, toBeat: 2 })).toEqual([]);
        expect(selectMidiClipsForSchedulerWindow({ clips: replacement, fromBeat: 1, toBeat: 2 })).toEqual(replacement);
    });
});
