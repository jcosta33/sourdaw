import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { readRoleFamilyWords } from './roleFamilyWords';

/**
 * Words that may follow a family word without continuing its noun phrase: determiners, pronouns,
 * prepositions, conjunctions, auxiliaries, linking and common predicate verbs, and adverbs. Any other
 * word after a family word is a noun it modifies ("drum machine", "bus compression", "bass boost").
 */
const PHRASE_ENDERS: ReadonlySet<string> = new Set([
    ...['an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'its', 'their', 'it', 'them'],
    ...['they', 'he', 'she', 'we', 'you', 'i', 'some', 'a', 'any', 'all', 'each', 'every', 'no', 'both', 'other'],
    ...['in', 'on', 'at', 'of', 'for', 'to', 'from', 'with', 'without', 'by', 'about', 'over', 'under', 'into'],
    ...['onto', 'through', 'during', 'before', 'after', 'between', 'against', 'around', 'behind', 'beside'],
    ...['near', 'off', 'out', 'up', 'down', 'as', 'than', 'like', 'per', 'via', 'across', 'along', 'within'],
    ...['and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'when', 'while', 'because', 'although', 'though', 'then'],
    ...['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'has', 'have', 'had'],
    ...['will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', 'need', 'needs', 'needed'],
    ...['want', 'wants', 'feels', 'seem', 'seems', 'sounds', 'get', 'gets', 'got', 'lack', 'lacks', 'stay'],
    ...['stays', 'remain', 'remains', 'become', 'becomes', 'keep', 'keeps', 'sit', 'sits', 'clash', 'clashes'],
    ...['mask', 'masks', 'fight', 'fights', 'cut', 'cuts', 'dominate', 'dominates', 'drown', 'drowns', 'swamp'],
    ...['swamps', 'too', 'very', 'really', 'quite', 'rather', 'just', 'still', 'also', 'now', 'again', 'here'],
    ...['there', 'not', 'never', 'always', 'only', 'even', 'almost', 'slightly', 'much', 'more', 'less', 'most'],
    ...['few', 'many', 'bit', 'little', 'far', 'way', 'please', 'instead'],
    ...['alone', 'unchanged', 'untouched', 'intact', 'stay', 'out'],
    // Predicate adjectives and comparatives: "make the drums punchier", "the bass is muddy".
    ...['punchier', 'brighter', 'darker', 'warmer', 'cooler', 'louder', 'quieter', 'softer', 'tighter'],
    ...['cleaner', 'fatter', 'thicker', 'thinner', 'wider', 'narrower', 'smoother', 'harsher', 'heavier'],
    ...['lighter', 'fuller', 'bigger', 'smaller', 'stronger', 'weaker', 'deeper', 'higher', 'lower'],
    ...['crisper', 'snappier', 'boomier', 'muddier', 'clearer', 'drier', 'wetter', 'busier', 'livelier'],
    ...['muddy', 'thin', 'loud', 'quiet', 'harsh', 'dull', 'boomy', 'flat', 'weak', 'tight', 'punchy'],
    ...['bright', 'dark', 'warm', 'thick', 'fat', 'clean', 'dry', 'wet', 'big', 'small', 'wide', 'narrow'],
    ...['soft', 'hard', 'heavy', 'light', 'full', 'empty', 'busy', 'sharp', 'smooth', 'crisp', 'clear'],
    ...['boxy', 'honky', 'sibilant', 'brittle', 'buried', 'lost', 'dominant', 'overpowering'],
]);

/** Nouns that are also verbs: a plural family word is their subject ("the drums sound thin"), a singular one their modifier. */
const PLURAL_SUBJECT_VERBS: ReadonlySet<string> = new Set(['sound', 'feel']);

/** A boundary the normalization would erase: a family word before one never continues into the next clause. */
const CLAUSE_BOUNDARY = /[,;.!?:()\n]/u;

type FamilyWordUse = 'head' | 'modifier';

/** A hyphen joining two words into one compound modifier ("bass-heavy", "drum-like"). */
const COMPOUND_HYPHEN = /(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/u;

/** A clause's normalized words, and the positions of those a hyphen joins to the next word. */
type ClauseWords = { tokens: string[]; hyphenated: ReadonlySet<number> };

function readClauseWords(clause: string): ClauseWords {
    const tokens: string[] = [];
    const hyphenated = new Set<number>();
    const parts = clause.split(COMPOUND_HYPHEN);
    for (const [index, part] of parts.entries()) {
        tokens.push(
            ...normalizeAgentReferenceText(part)
                .split(' ')
                .filter((word) => word !== '')
        );
        if (index < parts.length - 1 && tokens.length > 0) {
            hyphenated.add(tokens.length - 1);
        }
    }
    return { tokens, hyphenated };
}

/** A family word heads its phrase unless a word continuing the phrase, or a hyphen into a compound, follows it. */
function readFamilyWordUses({ tokens, hyphenated }: ClauseWords, words: readonly string[]): FamilyWordUse[] {
    const plural = words[1];
    return tokens.flatMap((token, index): FamilyWordUse[] => {
        if (!words.includes(token)) {
            return [];
        }
        if (hyphenated.has(index)) {
            return ['modifier'];
        }
        const next = tokens[index + 1];
        if (next === undefined || PHRASE_ENDERS.has(next)) {
            return ['head'];
        }
        return token === plural && PLURAL_SUBJECT_VERBS.has(next) ? ['head'] : ['modifier'];
    });
}

function readUses<TRole extends string>(text: string, roles: readonly TRole[], use: FamilyWordUse): TRole[] {
    const clauses = text
        .split(CLAUSE_BOUNDARY)
        .map(readClauseWords)
        .filter((clause) => clause.tokens.length > 0);
    return roles.filter((role) =>
        clauses.some((clause) => readFamilyWordUses(clause, readRoleFamilyWords(role)).includes(use))
    );
}

/**
 * The role families a text names as whole words, in the order `roles` lists them, and those it only
 * mentions as a modifier. A family word names its family only when it heads its noun phrase ("tighten
 * up the drums", "the bass is too muddy"); one that modifies the next word ("drum machine", "bus
 * compression", "bass boost") names an object or a quality of something else, so the request is about
 * that other thing, as does one a hyphen joins to the next word ("bass-heavy guitar", "drum-like keys").
 * The caller masks what must not count first (track names, quoted text, protection
 * clauses), since a word inside a name such as "Drum Bus" names that track and not the family.
 */
export function findNamedRoleFamilies<TRole extends string>(
    text: string,
    roles: readonly TRole[]
): { named: TRole[]; modifying: TRole[] } {
    return { named: readUses(text, roles, 'head'), modifying: readUses(text, roles, 'modifier') };
}
