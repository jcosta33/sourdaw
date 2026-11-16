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

function readFamilyWordUses(tokens: readonly string[], words: readonly string[]): FamilyWordUse[] {
    const plural = words[1];
    return tokens.flatMap((token, index): FamilyWordUse[] => {
        if (!words.includes(token)) {
            return [];
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
        .map((clause) => normalizeAgentReferenceText(clause).split(' '))
        .filter((tokens) => tokens.length > 0 && tokens[0] !== '');
    return roles.filter((role) =>
        clauses.some((tokens) => readFamilyWordUses(tokens, readRoleFamilyWords(role)).includes(use))
    );
}

/**
 * The role families a text names as whole words, in the order `roles` lists them, and those it only
 * mentions as a modifier. A family word names its family only when it heads its noun phrase ("tighten
 * up the drums", "the bass is too muddy"); one that modifies the next word ("drum machine", "bus
 * compression", "bass boost") names an object or a quality of something else, so the request is about
 * that other thing. The caller masks what must not count first (track names, quoted text, protection
 * clauses), since a word inside a name such as "Drum Bus" names that track and not the family.
 */
export function findNamedRoleFamilies<TRole extends string>(
    text: string,
    roles: readonly TRole[]
): { named: TRole[]; modifying: TRole[] } {
    return { named: readUses(text, roles, 'head'), modifying: readUses(text, roles, 'modifier') };
}
