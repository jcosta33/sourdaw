import {
    SEMANTIC_COMMAND_LIST_ROLE_FAMILIES,
    type SemanticCommandListRoleFamily,
} from '../../models/SemanticCommandList';

import { findNamedRoleFamilies } from './findNamedRoleFamilies';
import { CONNECTIVE_WORDS, KIND_NOUNS, protectionObjectForms, type Token } from './protectionObjectForms';

/** The kind nouns a role family word may carry ("the drum tracks", "the vocal bus"). */
const FAMILY_KIND_NOUNS: ReadonlySet<string> = new Set([
    'track',
    'tracks',
    'channel',
    'channels',
    'group',
    'groups',
    'bus',
    'buses',
]);

/** The kind nouns only the drums family carries ("the drum kit"). */
const DRUM_KIND_NOUNS: ReadonlySet<string> = new Set(['kit', 'kits']);

/** Quantifiers before a family word keep every track of it ("all the drums", "any of the drums", "every drum track"). */
const QUANTIFIERS: ReadonlySet<string> = new Set(['all', 'any', 'every', 'each']);

function isFamilyKindNoun(kindNoun: string, family: SemanticCommandListRoleFamily): boolean {
    return FAMILY_KIND_NOUNS.has(kindNoun) || (family === 'drums' && DRUM_KIND_NOUNS.has(kindNoun));
}

/** A project name `blankRanges` already replaced with its filler, or a quotation: neither names a family. */
function namesNoFamily(token: Token): boolean {
    return token.quoted || token.text.includes('□');
}

/** The prepositions a control run names its owner by, as the object forms read them ("the pan on Kick"). */
const OWNER_PREPOSITIONS: ReadonlySet<string> = new Set(['of', 'on']);

/**
 * A control run that opens the member as its verb ("mute the drums") changes the family; one followed by
 * an owner preposition ("faders of the drums", "pan on the drums") names the family's controls.
 */
function opensOnControlVerb(tokens: readonly Token[]): boolean {
    const runLength = tokens.findIndex((token) => !protectionObjectForms.isControl(token.lower));
    if (runLength === 0) {
        return false;
    }
    const next = runLength === -1 ? undefined : tokens[runLength];
    return next === undefined || !OWNER_PREPOSITIONS.has(next.lower);
}

/**
 * A singular kind noun after a family word written as a name ("the Drum Bus" capitalized, with no
 * such project object) names one object the object forms must bind, never the family.
 */
function namesKindObject(word: Token, kindNoun: Token): boolean {
    return KIND_NOUNS.has(kindNoun.lower) && protectionObjectForms.writesUnboundName([word, kindNoun]);
}

/**
 * The tracks a protection member keeps when it names one role family and nothing else but its
 * controls, quantifiers before it and a kind noun after it ("the drums", "all the drum tracks", "the
 * drum kit", "the vocals' sends"). A control opening the member as its verb ("mute the drums") names
 * what the request changes and protects nothing. The tokens come with project names blanked and
 * quotations flagged, so "Drum Bus" and a quoted "drums" name no family, and a capitalized singular
 * kind form of an absent object ("the Drum Bus") is left to the object forms' unbound refusal. A
 * family no track resolves to is none, so the object forms read the member as before.
 */
export function readRoleFamilyProtection(
    tokens: readonly Token[],
    familyTrackIds: (family: SemanticCommandListRoleFamily) => string[]
): { trackIds: string[]; controls: string[] } | null {
    if (tokens.some(namesNoFamily) || opensOnControlVerb(tokens)) {
        return null;
    }
    const content = tokens.filter((token) => !CONNECTIVE_WORDS.has(token.lower));
    const named = content.filter((token) => !protectionObjectForms.isControl(token.lower));
    const firstNamed = named.findIndex((token) => !QUANTIFIERS.has(token.lower));
    const [word, kindNoun, ...rest] = firstNamed === -1 ? [] : named.slice(firstNamed);
    if (word === undefined || rest.length > 0 || (kindNoun !== undefined && namesKindObject(word, kindNoun))) {
        return null;
    }
    const [family, ...others] = findNamedRoleFamilies(word.lower, SEMANTIC_COMMAND_LIST_ROLE_FAMILIES).named;
    const fitsKindNoun = kindNoun === undefined || (family !== undefined && isFamilyKindNoun(kindNoun.lower, family));
    if (family === undefined || others.length > 0 || !fitsKindNoun) {
        return null;
    }
    const trackIds = familyTrackIds(family);
    if (trackIds.length === 0) {
        return null;
    }
    const controls = content
        .filter((token) => protectionObjectForms.isControl(token.lower))
        .map((token) => token.lower);
    return { trackIds, controls };
}
