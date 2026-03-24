/**
 * Sample auto-tagging helpers: rule-based tagging, fingerprint generation,
 * and ID counter for sample entries.
 */

import { type SampleTag, type SampleCategory } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export const AUTO_TAG_RULES: Array<{ pattern: RegExp; tags: string[]; category: SampleCategory }> = [
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
];

/**
 * Auto-tag a sample by matching its name and path against known patterns.
 */
export function autoTagSample(name: string, path: string): { tags: SampleTag[]; category: SampleCategory } {
    const tags: SampleTag[] = [];
    let category: SampleCategory = 'other';
    const fullText = `${name} ${path}`;

    for (const rule of AUTO_TAG_RULES) {
        if (rule.pattern.test(fullText)) {
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
 * Generate a simple string fingerprint from name + path.
 * In production this would use an audio perceptual hash.
 */
export function generateFingerprint(name: string, path: string): string {
    let hash = 0;
    const str = `${name}:${path}`;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
    }
    return `fp-${Math.abs(hash).toString(36)}`;
}

let nextSampleId = 1;

export function getNextSampleId(): string {
    return `sample-${nextSampleId++}`;
}
