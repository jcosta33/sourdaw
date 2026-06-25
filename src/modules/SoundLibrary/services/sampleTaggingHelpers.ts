/**
 * Sample auto-tagging helpers: rule-based tagging, fingerprint generation,
 * and ID counter for sample entries.
 */

import { type SampleTag, type SampleCategory } from '../models/SampleEntry';

/**
 * Auto-tag rules. Each `pattern` is anchored at token boundaries (see
 * {@link tokenize} and {@link ruleMatches}) so an alternative only matches a
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
 * `.`, `/`, and whitespace) collapsed to a single space, and padded with a
 * leading and trailing space so the first and last tokens have boundaries.
 *
 * Treating `_` as a separator (unlike the `\b` word boundary, for which `_`
 * is a word character) is what lets a rule match `perc` in `perc_01.wav`
 * while still rejecting `superconductor`.
 */
function tokenize(name: string, path: string): string {
    return ` ${`${name} ${path}`.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ')} `;
}

/**
 * Test a rule against the tokenized text, requiring each alternative to match a
 * whole token (bounded by spaces). The alternation's own optional separators
 * (`.?`) match the collapsed single space, so multi-token spellings such as
 * `hi hat` and `bass drum` still match.
 */
function ruleMatches(pattern: RegExp, tokenized: string): boolean {
    const anchored = new RegExp(`(?<=\\s)(?:${pattern.source})(?=\\s)`, pattern.flags.replace('g', ''));
    return anchored.test(tokenized);
}

/**
 * Auto-tag a sample by matching its name and path against known patterns.
 */
export function autoTagSample(name: string, path: string): { tags: SampleTag[]; category: SampleCategory } {
    const tags: SampleTag[] = [];
    let category: SampleCategory = 'other';
    const tokenized = tokenize(name, path);

    for (const rule of AUTO_TAG_RULES) {
        if (ruleMatches(rule.pattern, tokenized)) {
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
