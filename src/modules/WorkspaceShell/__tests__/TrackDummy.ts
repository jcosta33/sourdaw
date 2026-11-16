import { type Clip, type Track } from '#/modules/Arrangement/stores';

type TrackDummyOverrides = {
    id?: string;
    kind?: Track['kind'];
    armed?: boolean;
    showVariationLanes?: boolean;
    clipId?: string;
    clipType?: Clip['type'];
    clipEndBeat?: number;
};

/** A complete track holding one clip; each spec overrides only the fields it varies. */
export const makeTrackDummy = ({
    id = 'track-1',
    kind = 'midi',
    armed = false,
    showVariationLanes = false,
    clipId = 'clip-1',
    clipType = 'midi',
    clipEndBeat = 4,
}: TrackDummyOverrides = {}): Track => {
    const clip: Clip = {
        id: clipId,
        trackId: id,
        name: 'Clip',
        type: clipType,
        startBeat: 0,
        endBeat: clipEndBeat,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
    return {
        id,
        name: 'Track',
        kind,
        muted: false,
        soloed: false,
        armed,
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
        showVariationLanes,
    };
};
