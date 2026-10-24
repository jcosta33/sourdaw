/** The vocabulary of the object forms a protection names a project object by, and how each is read. */

/** A phrase naming the rest of the mix, which stands for no particular object a protection must bind. */
export const REST_OF_MIX =
    /^(?:everything(?:\s+else)?|anything\s+else|all\s+else|(?:the\s+)?rest|(?:the\s+)?others|the\s+rest(?:\s+of\s+(?:it|the\s+(?:mix|project|tracks|session|arrangement|song)))?|(?:all\s+)?(?:the\s+)?other\s+tracks|every\s+other\s+track|the\s+others|the\s+remaining\s+tracks)(?:\s+(?:the\s+same|as\s+is))?$/iu;
/** A project-wide setting, which no object a batch could target carries. */
export const PROJECT_SETTING =
    /^(?:the\s+)?(?:tempo|bpm|time\s+signature|meter|key\s+signature|loop(?:\s+region)?|metronome)$/iu;
export const CONNECTIVE_WORDS: ReadonlySet<string> = new Set([
    'the',
    'a',
    'an',
    'of',
    'and',
    'or',
    'both',
    'my',
    'your',
    'our',
    'in',
    'on',
    'at',
    'to',
    'for',
    'from',
    'by',
    'with',
    'into',
    'than',
]);
/** The mixer controls a protection may qualify an object with, in the singular; a plural reads as its singular. */
export const CONTROL_WORDS: ReadonlySet<string> = new Set([
    'pan',
    'panning',
    'solo',
    'mute',
    'fader',
    'gain',
    'level',
    'volume',
    'arm',
    'send',
    'routing',
    'output',
    'setting',
]);
export const SEND_ACTIONS: readonly string[] = ['addSend', 'removeSend', 'setSend'];
/** A singular kind of object beside its name ("the Ghost track"); a plural names a category, never an object. */
export const KIND_NOUNS: ReadonlySet<string> = new Set([
    'track',
    'bus',
    'group',
    'channel',
    'clip',
    'plugin',
    'device',
    'send',
    'return',
    'vca',
]);
/** The kind nouns that name a track itself, so a track's name beside one protects the whole track. */
export const TRACK_KIND_NOUNS: ReadonlySet<string> = new Set(['track', 'bus', 'group', 'channel', 'return', 'vca']);
/** The kinds of track, which beside `track` name a category ("the audio track"), not an object. */
export const TRACK_KIND_WORDS: ReadonlySet<string> = new Set([
    'audio',
    'instrument',
    'midi',
    'folder',
    'group',
    'return',
    'aux',
    'bus',
    'vca',
]);
/** Words that point at the selection rather than name an object ("the selected clip"). */
export const SELECTION_WORDS: ReadonlySet<string> = new Set(['selected', 'this', 'that', 'current']);
/**
 * Words that stand for the project's own mix routing or a convention of one, never for a named object:
 * "the Master bus", "the FX return", "the Click track".
 */
export const CONVENTIONAL_WORDS: ReadonlySet<string> = new Set([
    'master',
    'mix',
    'stereo',
    'main',
    'fx',
    'click',
    'parallel',
    'sidechain',
]);

function isControl(lower: string): boolean {
    return CONTROL_WORDS.has(lower) || CONTROL_WORDS.has(lower.replace(/s$/u, ''));
}

export type Token = { text: string; lower: string; quoted: boolean; capitalized: boolean };

function readTokens(blanked: string, masked: string, range: { start: number; end: number }): Token[] {
    // A capital carries no signal at the start of a sentence or clause, nor in a request written without lowercase.
    const writesCase = /\p{Ll}/u.test(masked);
    return Array.from(blanked.slice(range.start, range.end).matchAll(/[\p{L}\p{N}□]+/gu), (match) => {
        const index = range.start + match.index;
        const before = masked.slice(0, index).trimEnd();
        const startsClause = before.length === 0 || /[.!?\n;:]$/u.test(before);
        return {
            text: match[0],
            lower: match[0].toLocaleLowerCase(),
            quoted: masked[index] === ' ' && blanked[index] !== ' ',
            capitalized: writesCase && /^\p{Lu}/u.test(match[0]) && !startsClause,
        };
    });
}

export type ProtectableObjectName = { name: string; kind: 'track' | 'bus' | 'group'; trackIds: string[] };
export type ObjectForm = { kind: 'unbound'; text: string } | { kind: 'variant'; trackIds: string[] } | null;

/** Whether the tokens are written as a name: capitalized outside a sentence start, or quoted. */
function isWrittenAsName(tokens: readonly Token[]): boolean {
    return tokens.some((token) => token.capitalized || token.quoted);
}

const KIND_OBJECT: Readonly<Record<string, ProtectableObjectName['kind']>> = {
    track: 'track',
    channel: 'track',
    bus: 'bus',
    return: 'bus',
    group: 'group',
    vca: 'group',
};

/** The tracks the one project object a name is a singular or plural variant of, of the kind beside it. */
function readVariantTracks(
    subject: readonly Token[],
    kindNoun: string,
    objects: readonly ProtectableObjectName[]
): string[] | null {
    const kind = KIND_OBJECT[kindNoun];
    const name = subject.map((token) => token.lower).join(' ');
    const variant = name.endsWith('s') ? name.slice(0, -1) : `${name}s`;
    const kinds: Array<ProtectableObjectName['kind']> = kind === 'track' ? ['track', 'bus'] : [kind ?? 'track'];
    const matches = objects.filter((object) => object.name === variant && kinds.includes(object.kind));
    const [only] = matches;
    return kind !== undefined && matches.length === 1 && only !== undefined ? only.trackIds : null;
}

/**
 * The object form a member names, if any: a control of a name ("the fader of Ghost", "the pan on Kick"),
 * its possessive control ("Ghost's fader"), a control right after it ("the Kick fader"), or a singular
 * kind of it ("the Ghost track"). A name that is written as one refuses when it binds to nothing; a kind
 * form whose name is a variant of exactly one project object of that kind binds to it instead.
 */
function readObjectForm(
    tokens: readonly Token[],
    possessive: boolean,
    objects: readonly ProtectableObjectName[]
): ObjectForm {
    const unbound = (named: readonly Token[]): ObjectForm => {
        const conventional = named.some((token) => CONVENTIONAL_WORDS.has(token.lower));
        if (!isWrittenAsName(named) || conventional) {
            return null;
        }
        return { kind: 'unbound', text: named.map((t) => t.text).join(' ') };
    };
    const ofIndex = tokens.findIndex((token) => token.lower === 'of' || token.lower === 'on');
    if (ofIndex > 0) {
        const before = tokens.slice(0, ofIndex).filter((token) => !CONNECTIVE_WORDS.has(token.lower));
        const after = tokens.slice(ofIndex + 1).filter((token) => !CONNECTIVE_WORDS.has(token.lower));
        const subject = after.map((token) => token.lower).join(' ');
        const isControlOf = before.length > 0 && before.every((token) => isControl(token.lower));
        if (isControlOf && after.length > 0 && !REST_OF_MIX.test(subject) && !PROJECT_SETTING.test(subject)) {
            return unbound(after);
        }
    }
    const content = tokens.filter((token) => !CONNECTIVE_WORDS.has(token.lower));
    const names = content.filter((token) => !isControl(token.lower) && !KIND_NOUNS.has(token.lower));
    const last = content.at(-1);
    // The control follows the name ("the Kick fader"); one before a word names a concept ("the Gain Staging").
    const endsOnControl = last !== undefined && (possessive ? isControl(last.lower) : CONTROL_WORDS.has(last.lower));
    // A title-cased compound ("Overall Level") does not establish a separate owner. A possessive or
    // quoted owner does, as does the ordinary name followed by a lowercase control ("the Kick pan").
    const separatesOwner = possessive || last?.capitalized !== true || names.some((token) => token.quoted);
    if (names.length > 0 && endsOnControl && separatesOwner) {
        return unbound(names);
    }
    const subject = content.slice(0, -1).filter((token) => token.lower !== 'vca');
    if (last === undefined || !KIND_NOUNS.has(last.lower) || subject.length === 0) {
        return null;
    }
    if (subject.every((token) => TRACK_KIND_WORDS.has(token.lower) || SELECTION_WORDS.has(token.lower))) {
        return null;
    }
    const variantTracks = readVariantTracks(subject, last.lower, objects);
    if (variantTracks !== null) {
        return { kind: 'variant', trackIds: variantTracks };
    }
    return unbound(subject);
}

export const protectionObjectForms = { isControl, readTokens, readObjectForm } as const;
