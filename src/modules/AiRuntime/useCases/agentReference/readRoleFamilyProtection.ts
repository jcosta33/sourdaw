import {
    SEMANTIC_COMMAND_LIST_ROLE_FAMILIES,
    type SemanticCommandListRoleFamily,
} from '../../models/SemanticCommandList';

import { findNamedRoleFamilies } from './findNamedRoleFamilies';
import { CONNECTIVE_WORDS, protectionObjectForms, type Token } from './protectionObjectForms';

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
 * The tracks a protection member keeps when it names one role family and nothing else but its
 * controls and a kind noun after it ("the drums", "the drum tracks", "the vocals' sends"). A control
 * opening the member as its verb ("mute the drums") names what the request changes and protects nothing. The tokens
 * come with project names blanked and quotations flagged, so "Drum Bus" and a quoted "drums" name no
 * family. A family no track resolves to is none, so the object forms read the member as before.
 */
export function readRoleFamilyProtection(
    tokens: readonly Token[],
    familyTrackIds: (family: SemanticCommandListRoleFamily) => string[]
): { trackIds: string[]; controls: string[] } | null {
    if (tokens.some(namesNoFamily) || opensOnControlVerb(tokens)) {
        return null;
    }
    const content = tokens.filter((token) => !CONNECTIVE_WORDS.has(token.lower));
    const words = content.filter((token) => !protectionObjectForms.isControl(token.lower)).map((token) => token.lower);
    const [word, kindNoun, ...rest] = words;
    const hasOnlyKindNoun = kindNoun === undefined || FAMILY_KIND_NOUNS.has(kindNoun);
    if (word === undefined || rest.length > 0 || !hasOnlyKindNoun) {
        return null;
    }
    const [family, ...others] = findNamedRoleFamilies(word, SEMANTIC_COMMAND_LIST_ROLE_FAMILIES).named;
    const trackIds = family === undefined || others.length > 0 ? [] : familyTrackIds(family);
    if (trackIds.length === 0) {
        return null;
    }
    const controls = content
        .filter((token) => protectionObjectForms.isControl(token.lower))
        .map((token) => token.lower);
    return { trackIds, controls };
}
