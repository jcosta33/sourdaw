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

/**
 * A name that is only an abbreviation or an ambiguous word ("oh", "bd", "sd", "china"), optionally
 * followed by its mic or position qualifiers. Anywhere else in a longer name those letters are
 * ordinary words ("Oh Yeah Vox"), so they match only as the whole name.
 */
function wholeNameWithQualifiers(words: string, qualifiers: string): string {
    return String.raw`^\s*(?:${words})(?:\s+(?:${qualifiers}|\d+))*\s*$`;
}

const NAME_ROLES: ReadonlyArray<[CanonicalTrackRole, RegExp]> = [
    [
        'kick',
        new RegExp(
            String.raw`\b(?:kick|kicks)\b|${wholeNameWithQualifiers('bd', 'in|out|inside|outside|sub|close|far|mic')}`
        ),
    ],
    ['snare', new RegExp(String.raw`\bsnares?\b|${wholeNameWithQualifiers('sd', 'top|bottom|side|close|far|mic')}`)],
    // A bare "hat" is also a garment and a football term ("Black Hat Synth", "Hat Trick").
    [
        'hi-hat',
        new RegExp(
            String.raw`\b(?:hi hat|hi hats|hihat|hihats|hh)\b|${wholeNameWithQualifiers('hats?', 'open|closed|pedal|mic')}`
        ),
    ],
    ['tom', /\btoms?\b/],
    [
        'cymbal',
        new RegExp(
            String.raw`\b(?:cymbals?|ride|crash)\b|${wholeNameWithQualifiers('china|splash', 'left|right|l|r|mic')}`
        ),
    ],
    ['percussion', /\b(?:percussion|perc|clap|claps|rim|rimshot|shaker|tambourine|cowbell|conga|bongo)\b/],
    ['overhead', new RegExp(String.raw`\boverheads?\b|${wholeNameWithQualifiers('oh', 'left|right|l|r|mono|stereo')}`)],
    // A room needs a drum word beside it: room tone and "Room" alone name non-drum tracks.
    ['room', /\brooms?(?=\s+drums?\b)|(?<=\bdrums?\s+)rooms?\b/],
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

/**
 * Words that describe a track without naming its part ("Rim Click", "Brass Snare", "String Bass",
 * "Guide Vocal"). They claim a name only when no role above does, so they never turn a name that
 * another role already names into a conflict.
 */
const MODIFIER_NAME_ROLES: ReadonlyArray<[CanonicalTrackRole, RegExp]> = [
    ['strings', /\bstrings?\b/],
    ['brass', /\bbrass\b/],
    // Session furniture that carries no part of the song.
    ['utility', /\b(?:click|metronome|reference|ref|guide|cue|hat trick)\b/],
];

const SPECIFIC_DRUM_ROLES: ReadonlySet<CanonicalTrackRole> = new Set([
    'kick',
    'snare',
    'hi-hat',
    'tom',
    'cymbal',
    'percussion',
    'overhead',
    'room',
]);

// The kit-mic roles a generic drum word may qualify when it comes first ("Drum Overheads").
const KIT_MIC_ROLES: ReadonlySet<CanonicalTrackRole> = new Set(['overhead', 'room']);

// An unqualified "vocal"/"vocals"/"vox" carries no dedicated pattern above: the canonical set has
// no generic vocal role, so it must be resolved to lead or backing rather than matched directly.
const BARE_VOCAL_WORD = /\b(?:vocals?|vox)\b/;
const BACKING_VOCAL_QUALIFIER = /\b(?:backing|background|bgv)\b/;

function normalizedTokens(name: string): string {
    // A truncated imported name could hide contradictory evidence after the cut.
    if (name.length > 256) {
        return '';
    }
    return name
        .normalize('NFKD')
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, ' ');
}

function namedRolesFromTokens(tokens: string): CanonicalTrackRole[] {
    return NAME_ROLES.filter(([, pattern]) => pattern.test(tokens)).map(([role]) => role);
}

function modifierRolesFromTokens(tokens: string): CanonicalTrackRole[] {
    return MODIFIER_NAME_ROLES.filter(([, pattern]) => pattern.test(tokens)).map(([role]) => role);
}

function namedRoles(name: string): CanonicalTrackRole[] {
    return namedRolesFromTokens(normalizedTokens(name));
}

function compoundAdjacencyTokens(name: string): string {
    // A truncated imported name could hide contradictory evidence after the cut.
    if (name.length > 256) {
        return '';
    }
    // Only the two legal joiners collapse to whitespace here; every connector ("and", "&", "+",
    // "/", ",") stays literal, so it still separates the two role words in the checks below.
    return name.normalize('NFKD').toLowerCase().replaceAll(/[-_]+/g, ' ');
}

function roleSpans(tokens: string, role: CanonicalTrackRole): Array<{ start: number; end: number }> {
    const entry = NAME_ROLES.find(([candidate]) => candidate === role);
    if (!entry) {
        return [];
    }
    const pattern = new RegExp(entry[1].source, `${entry[1].flags.replace('g', '')}g`);
    return Array.from(tokens.matchAll(pattern), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}

function hasIndependentBareVocal(tokens: string, role: CanonicalTrackRole): boolean {
    const qualifiedSpans = roleSpans(tokens, role);
    const pattern = new RegExp(BARE_VOCAL_WORD.source, 'g');
    return Array.from(tokens.matchAll(pattern)).some((match) => {
        const start = match.index;
        const end = start + match[0].length;
        return !qualifiedSpans.some((span) => span.start <= start && span.end >= end);
    });
}

/**
 * Interprets a name matching exactly two patterns as one convention-backed role instead of a
 * genuine conflict. Only these paired combinations carry an unambiguous studio meaning, and only
 * when written as one compound: the two words must be directly adjacent, joined by nothing but
 * whitespace, a hyphen, or an underscore. Any connector between them, or the wrong order for the
 * drum rules, names two separate things and keeps the conflict.
 */
function resolveNamedRoleConflict(roles: readonly CanonicalTrackRole[], name: string): CanonicalTrackRole | null {
    if (roles.length !== 2) {
        return null;
    }
    const tokens = compoundAdjacencyTokens(name);
    const [roleA, roleB] = roles as [CanonicalTrackRole, CanonicalTrackRole];
    const spansA = roleSpans(tokens, roleA);
    const spansB = roleSpans(tokens, roleB);
    if (spansA.length !== 1 || spansB.length !== 1) {
        return null;
    }
    const spanA = spansA[0]!;
    const spanB = spansB[0]!;
    // Order the pair by where each role actually appears in the name, not by pattern order.
    const aIsFirst = spanA.start <= spanB.start;
    const firstRole = aIsFirst ? roleA : roleB;
    const secondRole = aIsFirst ? roleB : roleA;
    const firstSpan = aIsFirst ? spanA : spanB;
    const secondSpan = aIsFirst ? spanB : spanA;
    if (!/^\s+$/.test(tokens.slice(firstSpan.end, secondSpan.start))) {
        return null;
    }
    // A specific drum role named directly before the generic "drums" is the specific role.
    if (secondRole === 'drums' && SPECIFIC_DRUM_ROLES.has(firstRole)) {
        return firstRole;
    }
    if (firstRole === 'drums' && KIT_MIC_ROLES.has(secondRole)) {
        return secondRole;
    }
    // "Bass drum"/"bass drums" names the kick, by General MIDI and studio convention.
    if (firstRole === 'bass' && secondRole === 'drums') {
        return 'kick';
    }
    // "Bass guitar" names the bass, by studio convention.
    if (firstRole === 'bass' && secondRole === 'guitar') {
        return 'bass';
    }
    // "Synth" directly adjacent to exactly one other role yields that other role, in either order.
    if (firstRole === 'synth') {
        return secondRole;
    }
    if (secondRole === 'synth') {
        return firstRole;
    }
    return null;
}

/** An unqualified vocal word is the lead by convention; a backing qualifier keeps it backing. */
function resolveBareVocalRole(tokens: string): CanonicalTrackRole | null {
    if (!BARE_VOCAL_WORD.test(tokens)) {
        return null;
    }
    return BACKING_VOCAL_QUALIFIER.test(tokens) ? 'backing vocal' : 'lead vocal';
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
    const tokens = normalizedTokens(input.track.name);
    const roles = namedRolesFromTokens(tokens);
    const bareVocalRole = resolveBareVocalRole(tokens);
    if (
        bareVocalRole &&
        hasIndependentBareVocal(tokens, bareVocalRole) &&
        roles.some((role) => role !== bareVocalRole)
    ) {
        return { role: 'unknown', source: 'name-tags', evidence: 'conflicting-name-tags' };
    }
    if (roles.length > 1) {
        const resolved = resolveNamedRoleConflict(roles, input.track.name);
        if (resolved) {
            return { role: resolved, source: 'name-tags', evidence: 'resolved-name-tags' };
        }
        return { role: 'unknown', source: 'name-tags', evidence: 'conflicting-name-tags' };
    }
    if (roles.length === 1) {
        return { role: roles[0]!, source: 'name-tags', evidence: 'name-tokens' };
    }
    if (bareVocalRole) {
        return { role: bareVocalRole, source: 'name-tags', evidence: 'resolved-name-tags' };
    }
    const modifiers = modifierRolesFromTokens(tokens);
    if (modifiers.length > 1) {
        return { role: 'unknown', source: 'name-tags', evidence: 'conflicting-name-tags' };
    }
    if (modifiers.length === 1) {
        return { role: modifiers[0]!, source: 'name-tags', evidence: 'name-tokens' };
    }
    return contentRole(input);
}
