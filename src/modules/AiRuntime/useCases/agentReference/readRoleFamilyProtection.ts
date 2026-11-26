import {
    SEMANTIC_COMMAND_LIST_ROLE_FAMILIES,
    type SemanticCommandListRoleFamily,
} from '../../models/SemanticCommandList';
import { CANONICAL_ROLE_OPTIONS, CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';

import { findAgentReferenceNameSpans } from './findAgentReferenceNameSpans';
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

/** The tracks the shared selector resolver places in a role family or in one canonical role. */
export type RoleTrackIds = (predicate: { roleFamily: SemanticCommandListRoleFamily } | { role: string }) => string[];

/**
 * The canonical roles a protection names by their own phrase: every role of a source family whose
 * phrase is not the family's own word, which the family reading takes ("the backing vocals", "the
 * kick").
 */
const PHRASED_ROLES = CANONICAL_ROLE_OPTIONS.filter((role) => {
    const family = CANONICAL_ROLE_TO_RECIPE_ROLE[role];
    return family !== null && family !== 'bus' && family !== 'master' && role !== family;
});

/** The canonical role the words state as one whole role phrase, in either number ("backing vocals"). */
function readRolePhrase(words: readonly string[]): string | undefined {
    const phrase = words.join(' ');
    return PHRASED_ROLES.find((role) =>
        findAgentReferenceNameSpans(phrase, role, 'with-number-forms', []).some(
            (span) => span.start === 0 && span.end === phrase.length
        )
    );
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
    roleTrackIds: RoleTrackIds
): { trackIds: string[]; controls: string[] } | null {
    if (tokens.some(namesNoFamily) || opensOnControlVerb(tokens)) {
        return null;
    }
    const content = tokens.filter((token) => !CONNECTIVE_WORDS.has(token.lower));
    const named = content.filter((token) => !protectionObjectForms.isControl(token.lower));
    const firstNamed = named.findIndex((token) => !QUANTIFIERS.has(token.lower));
    const members = firstNamed === -1 ? [] : named.slice(firstNamed);
    const predicate = readFamilyPredicate(members) ?? readRolePredicate(members);
    if (predicate === null) {
        return null;
    }
    const trackIds = roleTrackIds(predicate);
    if (trackIds.length === 0) {
        return null;
    }
    const controls = content
        .filter((token) => protectionObjectForms.isControl(token.lower))
        .map((token) => token.lower);
    return { trackIds, controls };
}

/** A family word alone or with a kind noun it carries ("the drums", "the drum tracks"). */
function readFamilyPredicate(members: readonly Token[]): { roleFamily: SemanticCommandListRoleFamily } | null {
    const [word, kindNoun, ...rest] = members;
    if (word === undefined || rest.length > 0 || (kindNoun !== undefined && namesKindObject(word, kindNoun))) {
        return null;
    }
    const [family, ...others] = findNamedRoleFamilies(word.lower, SEMANTIC_COMMAND_LIST_ROLE_FAMILIES).named;
    const fitsKindNoun = kindNoun === undefined || (family !== undefined && isFamilyKindNoun(kindNoun.lower, family));
    if (family === undefined || others.length > 0 || !fitsKindNoun) {
        return null;
    }
    return { roleFamily: family };
}

/**
 * A whole role phrase, with or without a kind noun of its family after it ("the backing vocals", "the
 * kick track"), which keeps the tracks of that role alone. A phrase written as a name ("the Kick track"
 * with no such object) is left to the object forms' unbound refusal.
 */
function readRolePredicate(members: readonly Token[]): { role: string } | null {
    const last = members.at(-1);
    const hasKindNoun = last !== undefined && FAMILY_KIND_NOUNS.has(last.lower);
    const phrase = hasKindNoun ? members.slice(0, -1) : members;
    if (phrase.length === 0 || protectionObjectForms.writesUnboundName([...members])) {
        return null;
    }
    const role = readRolePhrase(phrase.map((token) => token.lower));
    return role === undefined ? null : { role };
}
