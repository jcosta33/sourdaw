import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CRUST_PARAM_IDS } from '../CrustParamIds';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');
const TABLE_SOURCE = 'src/modules/AudioEngine/models/CrustDspParamNames.ts';

/** The only ids this module authors that the engine never hears about. */
const STORE_ONLY_IDS = ['streamingPreset'];

/**
 * The weld between Crust's authoring ids and the engine's translation table.
 *
 * `CRUST_PARAM_IDS` (this module) and `CRUST_DSP_PARAM_NAMES` (AudioEngine)
 * each own one half of one fact: which camelCase project id maps to the
 * snake_case name the Rust engine matches. Models constants never cross module
 * boundaries, so the two tables cannot import each other and this spec reads
 * the AudioEngine table from its source. An engine id missing here — or
 * misspelled — is a knob whose write the loader cannot spell and the engine
 * silently ignores; an extra beyond the store-only set is vocabulary nothing
 * owns and reds until it is either wired or removed.
 */
describe('CrustParamIds is the camelCase half of the DSP name weld', () => {
    const source = readFileSync(join(REPO_ROOT, TABLE_SOURCE), 'utf8');
    const block = /const CRUST_DSP_PARAM_NAMES: Readonly<Record<string, string>> = \{([\s\S]*?)\n\};/.exec(source);
    expect(block, `${TABLE_SOURCE} must declare CRUST_DSP_PARAM_NAMES`).not.toBeNull();

    const dspKeys = Array.from(block![1]!.matchAll(/^\s*([A-Za-z0-9_]+):/gm)).map((entry) => entry[1]!);

    it('spells every id the engine translation table translates', () => {
        expect(dspKeys.length).toBeGreaterThan(0);
        const authored = Object.keys(CRUST_PARAM_IDS);
        for (const key of dspKeys) {
            expect(authored, `${key} must be spelled in CRUST_PARAM_IDS`).toContain(key);
        }
    });

    it('carries only the store-only ids beyond the engine vocabulary', () => {
        const extras = Object.keys(CRUST_PARAM_IDS).filter((key) => !dspKeys.includes(key));
        expect([...extras].sort()).toEqual([...STORE_ONLY_IDS].sort());
    });

    it('spells every id the way the descriptor declares it', () => {
        // Each project id is its own spelling: the table exists to own the
        // literal, not to translate it (translation is the DSP table's job).
        for (const [key, value] of Object.entries(CRUST_PARAM_IDS)) {
            expect(value, `${key} must map to itself`).toBe(key);
        }
    });

    it('a key the panel authors is present', () => {
        // Presence pin: an over-wide matchAll above would otherwise make both
        // directions pass vacuously against an empty or misparsed table.
        expect(CRUST_PARAM_IDS.satAlgorithm).toBe('satAlgorithm');
        expect(dspKeys).toContain('satAlgorithm');
    });
});
