import { type Clip } from '../models/Track';

let counter = 0;

export const ClipDummy = {
    create: (overrides?: Partial<Clip>): Clip => ({
        id: `clip-${++counter}`,
        trackId: 'track-1',
        name: 'Test Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'buffer-1',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '#ff0000',
        locked: false,
        muted: false,
        ...overrides,
    }),
};
