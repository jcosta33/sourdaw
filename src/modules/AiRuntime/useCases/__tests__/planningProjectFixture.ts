import { createHash } from 'node:crypto';

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

const SECTION_SPANS = [
    { name: 'Intro', startBeat: 0, endBeat: 16 },
    { name: 'Verse', startBeat: 16, endBeat: 48 },
    { name: 'Chorus', startBeat: 48, endBeat: 80 },
    { name: 'Bridge', startBeat: 80, endBeat: 96 },
    { name: 'Outro', startBeat: 96, endBeat: 112 },
];

/** Production stamps brief entries with `Date.now()`, so their figures run to thirteen digits. */
const CREATED_AT = 1_791_316_906_670;

/**
 * A version-4 UUID drawn from a hash of `seed`: the same shape and hex mix as
 * `crypto.randomUUID()`, which production mints ids from, yet the same on every run.
 */
export function fixtureUuid(seed: string): string {
    const hex = createHash('sha256').update(seed).digest('hex');
    const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Each id in the shape its producer mints it, seeded by the fixture's own name for the object. */
export const planningFixtureIds = {
    track: (index: number) => `track-${fixtureUuid(`track:${String(index)}`)}`,
    clip: (trackIndex: number, clipIndex: number) =>
        `clip-${fixtureUuid(`clip:${String(trackIndex)}:${String(clipIndex)}`)}`,
    device: (trackIndex: number, deviceIndex: number) =>
        `device-${fixtureUuid(`device:${String(trackIndex)}:${String(deviceIndex)}`).slice(0, 8)}`,
    section: (index: number) => `section-${fixtureUuid(`section:${String(index)}`).slice(0, 8)}`,
    briefEntry: (kind: string, index: number) => `${kind}-${fixtureUuid(`${kind}:${String(index)}`)}`,
};

const SECTIONS = SECTION_SPANS.map((span, index) => ({ id: planningFixtureIds.section(index), ...span }));

function createTrack(base: ProjectContext, index: number, clipsPerTrack: number): ProjectContextTrack {
    const profile = TRACK_PROFILES[index % TRACK_PROFILES.length]!;
    const round = Math.floor(index / TRACK_PROFILES.length);
    const name = round === 0 ? profile.name : `${profile.name} ${String(round + 1)}`;
    const devices = DEVICE_CHAIN.map((type, deviceIndex) => {
        const descriptor = base.availableDeviceTypes?.find((candidate) => candidate.id === type);
        if (descriptor === undefined) {
            throw new Error(`The device catalogue must offer ${type}.`);
        }
        return {
            id: planningFixtureIds.device(index, deviceIndex),
            name: descriptor.name,
            type,
            bypassed: false,
            parameters: descriptor.parameters ?? [],
        };
    });
    const clips = Array.from({ length: clipsPerTrack }, (_, clipIndex) => {
        const section = SECTIONS[1 + (clipIndex % 3)]!;
        const pass = Math.floor(clipIndex / 3);
        const offset = pass * 112;
        return {
            id: planningFixtureIds.clip(index, clipIndex),
            name: `${name} ${section.name}${pass === 0 ? '' : ` ${String(pass + 1)}`}`,
            type: profile.kind,
            startBeat: section.startBeat + offset,
            endBeat: section.endBeat + offset,
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
        };
    });
    return {
        id: planningFixtureIds.track(index),
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
 * A session a planning request realistically reads: named tracks, each with three clips (or
 * `clipsPerTrack`) and an EQ, compressor and reverb from the live catalogue, five arrangement
 * sections, and a production brief with constraints, section goals, track roles and locks. Every
 * id has the shape production mints it in. `base` supplies the transport and the device catalogue.
 */
export function createPlanningProject(base: ProjectContext, trackCount: number, clipsPerTrack = 3): ProjectContext {
    const tracks = Array.from({ length: trackCount }, (_, index) => createTrack(base, index, clipsPerTrack));
    const leadVocalId = planningFixtureIds.track(2);
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
            id: `brief-${fixtureUuid('brief')}`,
            revision: 2,
            vision: 'A warm, punchy indie-pop mix with an upfront vocal and a wide chorus.',
            references: [],
            hardConstraints: [
                {
                    id: planningFixtureIds.briefEntry('constraint', 0),
                    scope: { kind: 'project' },
                    statement: 'Integrated loudness lands at -14 LUFS.',
                    createdAt: CREATED_AT,
                },
            ],
            preferences: [],
            sectionGoals: [
                {
                    id: planningFixtureIds.briefEntry('goal', 0),
                    sectionId: SECTIONS[2]!.id,
                    statement: 'The chorus opens up wider than the verse.',
                    createdAt: CREATED_AT,
                },
            ],
            trackRoles: [
                {
                    id: planningFixtureIds.briefEntry('role', 0),
                    trackId: leadVocalId,
                    role: 'lead-vocal',
                    createdAt: CREATED_AT,
                },
            ],
            locks: [
                {
                    id: planningFixtureIds.briefEntry('lock', 0),
                    scope: { kind: 'project' },
                    statement: 'Keep the master below -1 dBTP.',
                    createdAt: CREATED_AT,
                },
                {
                    id: planningFixtureIds.briefEntry('lock', 1),
                    scope: { kind: 'track', trackId: leadVocalId },
                    statement: 'Do not change the lead vocal edit.',
                    createdAt: CREATED_AT,
                },
            ],
            decisions: [],
            unresolvedQuestions: [],
            sourceRunLinks: [],
            supersedesBriefId: null,
            supersededByBriefId: null,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
        },
    };
}
