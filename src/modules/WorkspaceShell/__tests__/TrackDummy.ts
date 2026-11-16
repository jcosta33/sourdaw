import { type Track } from '#/modules/Arrangement/stores';

import { ClipDummy } from './ClipDummy';

const defaultTrackId = 'track-1';

/**
 * A complete track holding one clip and the alternative that clip belongs to. A spec that needs a
 * different clip passes `clips` and `alternatives` together, keeping `clip.trackId` on the track id.
 */
export const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => {
        const id = overrides?.id ?? defaultTrackId;
        const clip = ClipDummy.create({ trackId: id });
        return {
            id,
            name: 'Track',
            kind: 'midi',
            muted: false,
            soloed: false,
            armed: false,
            gain: 1,
            pan: 0,
            color: '#ffffff',
            clips: [clip],
            devices: [],
            sends: [],
            midiFx: [],
            frozen: false,
            freezeState: { status: 'unfrozen' },
            parentId: null,
            collapsed: false,
            inputMonitoring: 'auto',
            hidden: false,
            disabled: false,
            height: 64,
            outputId: 'master',
            automationMode: 'read',
            groupId: null,
            soloSafe: false,
            notes: '',
            inputId: null,
            activeAlternativeId: `${id}-alternative`,
            alternatives: [{ id: `${id}-alternative`, name: 'Main', clips: [clip] }],
            vcaGroupId: null,
            midiOutputTrackId: null,
            followChordTrack: false,
            showVariationLanes: false,
            ...overrides,
        };
    },
};
