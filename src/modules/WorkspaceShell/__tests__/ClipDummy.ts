import { type Clip } from '#/modules/Arrangement/stores';

export const ClipDummy = {
    create: (overrides?: Partial<Clip>): Clip => ({
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Clip',
        type: 'midi',
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
        ...overrides,
    }),
};
