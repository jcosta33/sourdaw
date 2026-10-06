import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';

const TRACK_PROFILES: ReadonlyArray<{ name: string; kind: 'audio' | 'midi' }> = [
    { name: 'Kick', kind: 'midi' },
    { name: 'Bass', kind: 'midi' },
    { name: 'Lead Vocal', kind: 'audio' },
    { name: 'Rhythm Guitar', kind: 'audio' },
    { name: 'Pad', kind: 'midi' },
];

/** The chain a mixed track carries in a realistic session: tone, dynamics, space. */
const DEVICE_CHAIN = ['builtin-eq', 'builtin-compressor', 'builtin-reverb'] as const;

const SECTIONS = [
    { id: 'section-intro', name: 'Intro', startBeat: 0, endBeat: 16 },
    { id: 'section-verse', name: 'Verse', startBeat: 16, endBeat: 48 },
    { id: 'section-chorus', name: 'Chorus', startBeat: 48, endBeat: 80 },
    { id: 'section-bridge', name: 'Bridge', startBeat: 80, endBeat: 96 },
    { id: 'section-outro', name: 'Outro', startBeat: 96, endBeat: 112 },
];

function createTrack(base: ProjectContext, index: number): ProjectContextTrack {
    const profile = TRACK_PROFILES[index % TRACK_PROFILES.length]!;
    const round = Math.floor(index / TRACK_PROFILES.length);
    const name = round === 0 ? profile.name : `${profile.name} ${String(round + 1)}`;
    const trackId = `track-${String(index + 1)}`;
    const devices = DEVICE_CHAIN.map((type, deviceIndex) => {
        const descriptor = base.availableDeviceTypes?.find((candidate) => candidate.id === type);
        if (descriptor === undefined) {
            throw new Error(`The device catalogue must offer ${type}.`);
        }
        return {
            id: `${trackId}-device-${String(deviceIndex + 1)}`,
            name: descriptor.name,
            type,
            bypassed: false,
            parameters: descriptor.parameters ?? [],
        };
    });
    const clips = SECTIONS.slice(1, 4).map((section, clipIndex) => ({
        id: `${trackId}-clip-${String(clipIndex + 1)}`,
        name: `${name} ${section.name}`,
        type: profile.kind,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
        gain: 1,
        locked: false,
        muted: false,
        color: '#4a90d9',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        loopEnabled: false,
        midiOffsetBeats: 0,
        minimumLoopLengthBeats: 0.25,
        noteCount: profile.kind === 'midi' ? 32 : 0,
    }));
    return {
        id: trackId,
        name,
        kind: profile.kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        vcaGroupId: null,
        outputId: 'master',
        clipCount: clips.length,
        deviceCount: devices.length,
        clips,
        devices,
        sends: [],
    };
}

/**
 * A session a planning request realistically reads: named tracks, each with three clips and an
 * EQ, compressor and reverb from the live catalogue, five arrangement sections and a production
 * brief with locks. `base` supplies the transport and the device catalogue.
 */
export function createPlanningProject(base: ProjectContext, trackCount: number): ProjectContext {
    const tracks = Array.from({ length: trackCount }, (_, index) => createTrack(base, index));
    return {
        ...base,
        tempo: 124,
        sections: SECTIONS,
        tracks,
        selectedTrackId: tracks[0]?.id ?? null,
        selectedClipId: tracks[0]?.clips[0]?.id ?? null,
        selectedClipIds: tracks[0]?.clips[0] === undefined ? [] : [tracks[0].clips[0].id],
        productionBrief: {
            schemaVersion: 1,
            id: 'brief-1',
            revision: 2,
            vision: 'A warm, punchy indie-pop mix with an upfront vocal and a wide chorus.',
            references: [],
            hardConstraints: [],
            preferences: [],
            sectionGoals: [],
            trackRoles: [],
            locks: [
                {
                    id: 'lock-1',
                    scope: { kind: 'project' },
                    statement: 'Keep the master below -1 dBTP.',
                    createdAt: 1,
                },
                {
                    id: 'lock-2',
                    scope: { kind: 'track', trackId: 'track-3' },
                    statement: 'Do not change the lead vocal edit.',
                    createdAt: 2,
                },
            ],
            decisions: [],
            unresolvedQuestions: [],
            sourceRunLinks: [],
            supersedesBriefId: null,
            supersededByBriefId: null,
            createdAt: 1,
            updatedAt: 2,
        },
    };
}
