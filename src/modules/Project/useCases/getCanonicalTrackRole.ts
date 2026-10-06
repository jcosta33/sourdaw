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

// Instruments that carry a string count or material of their own, so "string(s)" beside them does
// not name a guitar.
const STRING_COUNT_OTHER_INSTRUMENTS = 'bass|violin|viola|cello|ukulele|uke|mandolin|banjo|bouzouki|sitar|harp';

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
    ['room', /\broom(?=\s+drums?\b)|(?<=\bdrums?\s+)rooms?\b/],
    ['drums', /\bdrums?\b/],
    ['bass', /\bbass\b/],
    ['lead vocal', /\b(?:lead vocals?|main vocals?)\b/],
    ['backing vocal', /\b(?:backing vocals?|background vocals?|bgv)\b/],
    // A guitar named by its string count before the singular ("12 String") or its material
    // ("Nylon String", "Nylon Strings") is a guitar, not an orchestral strings section; "12 Strings"
    // is a section. The clause yields when another instrument is named beside it ("6 String Bass",
    // "8 String Ukulele"), and counts that name other instruments (a 5 string banjo) are not guitar
    // counts.
    [
        'guitar',
        new RegExp(
            String.raw`\b(?:guitars?|gtrs?)\b|(?<!\b(?:${STRING_COUNT_OTHER_INSTRUMENTS})\s+)\b(?:(?:6|7|8|12)\s+string|(?:nylon|steel)\s+strings?)\b(?!\s+(?:${STRING_COUNT_OTHER_INSTRUMENTS})\b)`
        ),
    ],
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
    // A string count or material before the word names an instrument's strings, not a section. The
    // material words are reachable here when the guitar clause above yields to another instrument
    // ("Nylon String Ukulele"), which must not fall through to an orchestral strings track.
    ['strings', /(?<!\b(?:nylon|steel)\s+)\bstrings\b|(?<!\b(?:\d+|nylon|steel)\s+)\bstring\b/],
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

const BASS_QUALIFIED_ROLES: ReadonlySet<CanonicalTrackRole> = new Set(['keys', 'pad']);

const DRUM_FAMILY_ROLES: ReadonlySet<CanonicalTrackRole> = new Set([...SPECIFIC_DRUM_ROLES, 'drums']);

// Separators that only label a name ("Drums (Room)", "Drums - Kick In", "Drums_Snare"). Anything
// else between two words ("&", "+", ",") joins separate things.
const LABELLING_SEPARATOR = /^[\s()[\]{}:./\\_–—-]*$/u;

// A word before a drum piece that adds or removes it ("Drums No Overheads", "w/ Room").
const CONJUNCTION_OR_NEGATION_WORDS: ReadonlySet<string> = new Set(['and', 'with', 'no', 'without', 'w', 'o', 'minus']);

function splitNameWords(name: string): { words: string[]; separators: string[] } {
    const lowered = name.normalize('NFKD').toLowerCase();
    return {
        words: lowered.match(/[a-z0-9]+/g) ?? [],
        separators: lowered.split(/[a-z0-9]+/).slice(1, -1),
    };
}

function countSpaces(text: string): number {
    return (text.match(/ /g) ?? []).length;
}

function wordSpanOfRole(tokens: string, role: CanonicalTrackRole): { first: number; last: number } | null {
    const spans = roleSpans(tokens, role);
    const span = spans[0];
    if (spans.length !== 1 || !span) {
        return null;
    }
    return { first: countSpaces(tokens.slice(0, span.start)), last: countSpaces(tokens.slice(0, span.end - 1)) };
}

/**
 * Whether a generic drums word and one specific drum piece are written as one label: directly
 * adjacent, or joined only by a labelling separator, in either order, with nothing before the
 * piece that adds or removes it.
 */
function labelsDrumPiece(name: string, piece: CanonicalTrackRole): boolean {
    // A truncated imported name could hide contradictory evidence after the cut.
    if (name.length > 256) {
        return false;
    }
    const { words, separators } = splitNameWords(name);
    const tokens = words.join(' ');
    const drums = wordSpanOfRole(tokens, 'drums');
    const pieceSpan = wordSpanOfRole(tokens, piece);
    if (!drums || !pieceSpan) {
        return false;
    }
    const [first, second] = drums.first < pieceSpan.first ? [drums, pieceSpan] : [pieceSpan, drums];
    if (second.first !== first.last + 1 || !LABELLING_SEPARATOR.test(separators[first.last] ?? '')) {
        return false;
    }
    if (pieceSpan.first === 0) {
        return true;
    }
    const wordBefore = words[pieceSpan.first - 1] ?? '';
    return (
        !CONJUNCTION_OR_NEGATION_WORDS.has(wordBefore) &&
        LABELLING_SEPARATOR.test(separators[pieceSpan.first - 1] ?? '')
    );
}

/**
 * Names that carry only drum-family evidence ("Kick & Snare", "Drums & Room") still say the track
 * is drums. A generic drums word with exactly one specific piece names that piece only when the
 * two are written as one label ("Drums (Room)", "Kick Drum"). A mixed-family conflict stays a
 * conflict, and null leaves the name to the other rules.
 */
function resolveDrumFamilyConflict(roles: readonly CanonicalTrackRole[], name: string): CanonicalTrackRole | null {
    if (!roles.every((role) => DRUM_FAMILY_ROLES.has(role))) {
        return null;
    }
    const piece = roles.find((role) => role !== 'drums');
    if (roles.length === 2 && roles.includes('drums') && piece !== undefined && labelsDrumPiece(name, piece)) {
        return piece;
    }
    return 'drums';
}

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

/** What the word "bass" means directly before another role word, or null when it keeps the conflict. */
function resolveBassQualifiedRole(secondRole: CanonicalTrackRole): CanonicalTrackRole | null {
    // "Bass drum"/"bass drums" names the kick, by General MIDI and studio convention.
    if (secondRole === 'drums') {
        return 'kick';
    }
    // "Bass guitar" names the bass, by studio convention.
    if (secondRole === 'guitar') {
        return 'bass';
    }
    // "Bass keys" and "bass pad" are a keys-family part voiced as a bass, not a bass instrument.
    if (BASS_QUALIFIED_ROLES.has(secondRole)) {
        return secondRole;
    }
    return secondRole === 'synth' ? 'bass' : null;
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
    if (firstRole === 'bass') {
        return resolveBassQualifiedRole(secondRole);
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
        const resolved =
            resolveDrumFamilyConflict(roles, input.track.name) ?? resolveNamedRoleConflict(roles, input.track.name);
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
