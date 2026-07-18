/**
 * Sample auto-tagging helpers: rule-based tagging, fingerprint generation,
 * and ID counter for sample entries.
 */

import { type SampleTag, type SampleCategory } from '../models/SampleEntry';

/**
 * Auto-tag rules. Each `pattern` is anchored at token boundaries (see
 * {@link tokenize} and {@link ANCHORED_RULE_PATTERNS}) so an alternative only matches a
 * whole word, never a substring buried inside another word — e.g. the `hat`
 * alternative tags `open_hat.wav` but not `whatever.wav`, and `perc` does not
 * fire on `superconductor`. Alternatives keep their intra-token optional
 * separator (`hi.?hat`, `bass.?drum`) so `hihat`/`hi-hat`/`hi hat` all match.
 *
 * `readonly`/`as const`: this is a fixed lookup table, not mutable state. The
 * `RegExp` literals carry no `/g` flag, so they hold no `lastIndex` state and
 * are safe to share across calls.
 */
export const AUTO_TAG_RULES = [
    { pattern: /kick|bd|bass.?drum/i, tags: ['kick', 'drum', 'low-end'], category: 'kicks' },
    { pattern: /snare|sd|snr/i, tags: ['snare', 'drum', 'percussive'], category: 'snares' },
    { pattern: /hi.?hat|hh|hat/i, tags: ['hi-hat', 'drum', 'metallic'], category: 'hi-hats' },
    { pattern: /clap|cp/i, tags: ['clap', 'percussive'], category: 'percussion' },
    { pattern: /perc/i, tags: ['percussion', 'rhythmic'], category: 'percussion' },
    { pattern: /bass/i, tags: ['bass', 'low-end'], category: 'bass' },
    { pattern: /synth|lead/i, tags: ['synth', 'melodic'], category: 'synth' },
    { pattern: /vox|vocal|voice/i, tags: ['vocal', 'human'], category: 'vocals' },
    { pattern: /fx|effect|riser|sweep|impact/i, tags: ['fx', 'effect'], category: 'fx' },
    { pattern: /loop|bpm/i, tags: ['loop', 'rhythmic'], category: 'loops' },
    { pattern: /one.?shot|hit|stab/i, tags: ['one-shot', 'short'], category: 'one-shots' },
    { pattern: /foley|ambient|room/i, tags: ['foley', 'ambient'], category: 'foley' },
    { pattern: /pad/i, tags: ['pad', 'sustained', 'atmospheric'], category: 'pads' },
    { pattern: /string|violin|cello|viola/i, tags: ['strings', 'orchestral'], category: 'strings' },
    { pattern: /brass|trumpet|trombone|horn/i, tags: ['brass', 'orchestral'], category: 'brass' },
    { pattern: /flute|oboe|clarinet|sax/i, tags: ['woodwinds', 'orchestral'], category: 'woodwinds' },
    { pattern: /guitar|gtr/i, tags: ['guitar', 'plucked'], category: 'guitar' },
    { pattern: /piano|keys|organ|rhodes/i, tags: ['piano', 'keys'], category: 'piano' },
] as const satisfies ReadonlyArray<{ pattern: RegExp; tags: readonly string[]; category: SampleCategory }>;

/**
 * Normalize a sample's name and path into a space-delimited token string:
 * lowercased, every run of non-alphanumeric characters (including `_`, `-`,
 * `.`, `/`, and whitespace) collapsed to a single space, every letter↔digit
 * transition split into separate tokens, and padded with a leading and
 * trailing space so the first and last tokens have boundaries.
 *
 * Treating `_` as a separator (unlike the `\b` word boundary, for which `_`
 * is a word character) is what lets a rule match `perc` in `perc_01.wav`
 * while still rejecting `superconductor`.
 *
 * Splitting on letter↔digit transitions (`kick808` → `kick 808`, `808kick` →
 * `808 kick`) is what lets a whole-token rule match digit-glued real-world
 * names — `Kick808`, `kick01`, `snare2`, `808kick` — that {@link ANCHORED_RULE_PATTERNS}
 * would otherwise miss, since a `\b` boundary does not exist between two word
 * characters. It does NOT loosen the whole-token rule into a substring match:
 * `bassline` keeps a single token and is still rejected by the `bass` rule.
 */
function tokenize(name: string, path: string): string {
    const collapsed = `${name} ${path}`.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ');
    const digitSplit = collapsed.replaceAll(/([a-z])([0-9])/g, '$1 $2').replaceAll(/([0-9])([a-z])/g, '$1 $2');
    return ` ${digitSplit} `;
}

/**
 * Whole-token-anchored form of each rule's pattern, derived once from the
 * module-constant {@link AUTO_TAG_RULES} (parallel by index). Each alternative
 * is required to match a whole token (bounded by spaces); the alternation's own
 * optional separators (`.?`) match the collapsed single space, so multi-token
 * spellings such as `hi hat` and `bass drum` still match. Building these at
 * module load avoids reallocating one `RegExp` per rule on every
 * {@link autoTagSample} call.
 */
const ANCHORED_RULE_PATTERNS: readonly RegExp[] = AUTO_TAG_RULES.map(
    (rule) => new RegExp(`(?<=\\s)(?:${rule.pattern.source})(?=\\s)`, rule.pattern.flags.replace('g', ''))
);

/**
 * Auto-tag a sample by matching its name and path against known patterns.
 */
export function autoTagSample(name: string, path: string): { tags: SampleTag[]; category: SampleCategory } {
    const tags: SampleTag[] = [];
    let category: SampleCategory = 'other';
    const tokenized = tokenize(name, path);

    for (let i = 0; i < AUTO_TAG_RULES.length; i++) {
        const rule = AUTO_TAG_RULES[i]!;
        if (ANCHORED_RULE_PATTERNS[i]!.test(tokenized)) {
            for (const tag of rule.tags) {
                if (!tags.some((t) => t.name === tag)) {
                    tags.push({ name: tag, source: 'auto', confidence: 0.8 });
                }
            }
            if (category === 'other') {
                category = rule.category;
            }
        }
    }

    return { tags, category };
}

/**
 * Deterministic djb2-style hash of a sample's `name:path`, used as a stable
 * cross-session identity for sample records. This is NOT an audio perceptual
 * fingerprint — it cannot be used for content-based similarity search
 * (two files with the same path but different content collide; the same
 * audio at two paths does not). A real perceptual hash needs to read the
 * decoded audio (see §137.1 in code-quality audit).
 */
export function generatePathHash(name: string, path: string): string {
    let hash = 0;
    const str = `${name}:${path}`;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
    }
    return `path-${Math.abs(hash).toString(36)}`;
}

export function getNextSampleId(): string {
    return `sample-${crypto.randomUUID()}`;
}
