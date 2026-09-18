import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GLUTEN_PARAM_IDS } from '../GlutenParamIds';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');
const TABLE_SOURCE = 'src/modules/AudioEngine/models/GlutenDspParamNames.ts';

/**
 * The weld between Gluten's authoring ids and the engine's translation table.
 *
 * `GLUTEN_PARAM_IDS` (this module) and `GLUTEN_DSP_PARAM_NAMES` (AudioEngine)
 * each own one half of one fact: which camelCase project id maps to the
 * snake_case name the Rust engine matches. Models constants never cross module
 * boundaries, so the two tables cannot import each other and this spec reads
 * the AudioEngine table from its source, the same read
 * `glutenTopologyGating.spec.ts` performs. A key added to either table without
 * the other reds here — which is the whole point: a parameter the panel can
 * author but the table cannot translate is a knob the engine silently ignores,
 * and a table entry nothing authors is dead vocabulary.
 */
describe('GlutenParamIds is the camelCase half of the DSP name weld', () => {
    const source = readFileSync(join(REPO_ROOT, TABLE_SOURCE), 'utf8');
    const block = /const GLUTEN_DSP_PARAM_NAMES: Readonly<Record<string, string>> = \{([\s\S]*?)\n\};/.exec(source);
    expect(block, `${TABLE_SOURCE} must declare GLUTEN_DSP_PARAM_NAMES`).not.toBeNull();

    const dspKeys = Array.from(block![1]!.matchAll(/^\s*([A-Za-z0-9_]+):/gm)).map((entry) => entry[1]!);

    it('declares exactly the ids the engine translation table translates', () => {
        expect(dspKeys.length).toBeGreaterThan(0);
        expect([...Object.keys(GLUTEN_PARAM_IDS)].sort()).toEqual([...dspKeys].sort());
    });

    it('spells every id the way the descriptor declares it', () => {
        // Each project id is its own spelling: the table exists to own the
        // literal, not to translate it (translation is the DSP table's job).
        for (const [key, value] of Object.entries(GLUTEN_PARAM_IDS)) {
            expect(value, `${key} must map to itself`).toBe(key);
        }
    });

    it('a key the panel authors is present', () => {
        // Presence pin: an over-wide matchAll above would otherwise make both
        // directions pass vacuously against an empty or misparsed table.
        expect(GLUTEN_PARAM_IDS.autoMakeup).toBe('autoMakeup');
        expect(dspKeys).toContain('autoMakeup');
    });
});
