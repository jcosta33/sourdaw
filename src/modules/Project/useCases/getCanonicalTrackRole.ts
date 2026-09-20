import { getPluginById } from '#/modules/Arrangement/useCases';
import { getFactoryDrumKitByIndex } from '#/modules/AudioEngine/useCases';
import { getStoredDrumVoiceMetadata } from '#/modules/Toaster/useCases';
import { isDrumDevice } from '#/utils/deviceTypeMatching';

import {
    CANONICAL_TRACK_ROLES,
    type CanonicalTrackRole,
    type CanonicalTrackRoleProjection,
} from '../models/CanonicalTrackRole';
import { type ProjectMidiNote } from '../models/ProjectData';
import { createBoundedRevisionToken } from '../services/createBoundedRevisionToken';

type Note = Pick<ProjectMidiNote, 'pitch'> & Partial<Omit<ProjectMidiNote, 'pitch'>>;
type Clip = { id: string; type: 'audio' | 'midi'; notes?: readonly Note[] };
type Device = { type: string; parameterValues: Readonly<Record<string, number>>; deviceState?: unknown };
type RoleInput = {
    track: { id: string; name: string; kind: string; clips: readonly Clip[]; devices: readonly Device[] };
    trackRoles?: readonly { trackId: string; role: string }[];
    notesByClipId?: Readonly<Record<string, readonly Note[]>>;
};

const NAME_ROLES: ReadonlyArray<[CanonicalTrackRole, RegExp]> = [
    ['kick', /\b(?:kick|kicks)\b/],
    ['snare', /\bsnares?\b/],
    ['hi-hat', /\b(?:hi hat|hi hats|hihat|hihats|hh)\b/],
    ['tom', /\btoms?\b/],
    ['cymbal', /\b(?:cymbals?|ride|crash)\b/],
    ['percussion', /\b(?:percussion|perc|clap|claps|rim|rimshot|shaker|tambourine|cowbell|conga|bongo)\b/],
    ['drums', /\bdrums?\b/],
    ['bass', /\bbass\b/],
    ['lead vocal', /\b(?:lead vocals?|main vocals?)\b/],
    ['backing vocal', /\b(?:backing vocals?|background vocals?|bgv)\b/],
    ['guitar', /\bguitars?\b/],
    ['keys', /\b(?:keys|keyboard|keyboards|piano|organ)\b/],
    ['synth', /\bsynths?\b/],
    ['pad', /\bpads?\b/],
    ['fx', /\b(?:fx|sfx|effects)\b/],
];

function namedRoles(name: string): CanonicalTrackRole[] {
    // A truncated imported name could hide contradictory evidence after the cut.
    if (name.length > 256) {
        return [];
    }
    const tokens = name
        .normalize('NFKD')
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, ' ');
    return NAME_ROLES.filter(([, pattern]) => pattern.test(tokens)).map(([role]) => role);
}

function authoredRole(input: RoleInput): CanonicalTrackRoleProjection | null {
    const authored = input.trackRoles?.filter((entry) => entry.trackId === input.track.id) ?? [];
    if (authored.length === 0) {
        return null;
    }
    const roles = authored.map((entry) => CANONICAL_TRACK_ROLES.find((role) => role === entry.role));
    if (roles.some((role) => role === undefined)) {
        return { role: 'unknown', source: 'authored', evidence: 'unsupported-authored-role' };
    }
    if (new Set(roles).size !== 1) {
        return { role: 'unknown', source: 'authored', evidence: 'conflicting-authored-roles' };
    }
    return { role: roles[0] ?? 'unknown', source: 'authored', evidence: 'authored-role' };
}

function storedVoices(device: Device): Array<{ pitch: number; family: CanonicalTrackRole | null }> | null {
    if (device.type === 'toaster') {
        const metadata = getStoredDrumVoiceMetadata(device.deviceState);
        return metadata.status === 'known' ? metadata.voices : null;
    }
    if (!isDrumDevice(device.type)) {
        return null;
    }
    const { kit, kitId } = device.parameterValues;
    const index = kit ?? kitId;
    if (
        index === undefined ||
        !Number.isInteger(index) ||
        index < 0 ||
        (kit !== undefined && kitId !== undefined && kit !== kitId)
    ) {
        return null;
    }
    const factory = getFactoryDrumKitByIndex(index);
    return (
        factory?.voices.flatMap((voice) => {
            const roles = namedRoles(voice.name);
            return Array.from({ length: voice.pitchRange[1] - voice.pitchRange[0] + 1 }, (_, offset) => ({
                pitch: voice.pitchRange[0] + offset,
                family: roles.length === 1 ? roles[0]! : null,
            }));
        }) ?? null
    );
}

function storedNotes(input: RoleInput, clip: Clip): readonly Note[] {
    if (input.notesByClipId && Object.hasOwn(input.notesByClipId, clip.id)) {
        return input.notesByClipId[clip.id] ?? [];
    }
    return clip.notes ?? [];
}

function contentRole(input: RoleInput): CanonicalTrackRoleProjection {
    const clips = input.track.clips.map((clip) => ({
        type: clip.type,
        notes: storedNotes(input, clip),
    }));
    const contentRevision = createBoundedRevisionToken(
        'stored-role-content',
        JSON.stringify([clips, input.track.devices])
    );
    const unknown = (evidence: CanonicalTrackRoleProjection['evidence']): CanonicalTrackRoleProjection => ({
        role: 'unknown',
        source: 'clip-content',
        evidence,
        contentRevision,
    });
    if (clips.some((clip) => clip.type === 'audio')) {
        return unknown('opaque-content');
    }
    const notes = clips.flatMap((clip) => clip.notes);
    if (notes.length === 0) {
        return { role: 'unknown', source: 'unknown', evidence: 'empty-content', contentRevision };
    }
    // Effects do not declare a voice. Unknown/external devices cannot prove a mapping.
    const instruments = input.track.devices.filter((device) => getPluginById(device.type)?.category !== 'effect');
    if (instruments.length !== 1) {
        return unknown('missing-instrument-metadata');
    }
    const voices = storedVoices(instruments[0]!);
    if (!voices) {
        return unknown('missing-instrument-metadata');
    }
    const families = new Set<CanonicalTrackRole>();
    for (const note of notes) {
        const matches = voices.filter((voice) => voice.pitch === note.pitch);
        const family = matches.length === 1 ? matches[0]?.family : null;
        if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 || !family) {
            return unknown('unmapped-drum-voice');
        }
        families.add(family);
    }
    return {
        role: families.size === 1 ? [...families][0]! : 'drums',
        source: 'clip-content',
        evidence: 'stored-drum-voices',
        contentRevision,
    };
}

/** Read only the supplied capture; never consult mutable owner stores or infer currently sounding output. */
export function getCanonicalTrackRole(input: RoleInput): CanonicalTrackRoleProjection {
    const authored = authoredRole(input);
    if (authored) {
        return authored;
    }
    if (input.track.kind === 'bus' || input.track.kind === 'master') {
        return { role: input.track.kind, source: 'name-tags', evidence: 'structural-kind' };
    }
    const roles = namedRoles(input.track.name);
    if (roles.length > 1) {
        return { role: 'unknown', source: 'name-tags', evidence: 'conflicting-name-tags' };
    }
    if (roles.length === 1) {
        return { role: roles[0]!, source: 'name-tags', evidence: 'name-tokens' };
    }
    return contentRole(input);
}
