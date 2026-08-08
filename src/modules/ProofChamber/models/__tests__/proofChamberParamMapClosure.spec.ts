import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, PARAM_MAP, expandSpacePreset, type SpaceType } from '../ProofChamberState';

/**
 * `PARAM_MAP` is the wire contract between the Dutch Oven panel and the plate,
 * and it had holes in both directions that nothing could see.
 *
 * `ProofChamberPanel.setParam` skips any key without a `PARAM_MAP` entry
 * (`if (!rustKey) { return; }`), and so does `selectSpace`. So a field added to
 * `ProofChamberEngineState` without a matching entry is a control that renders,
 * moves, stores its value and reaches nothing — silently, because the skip is
 * the normal path for `space`.
 *
 * Going the other way, the plate's `set_param` ends `_ => {}`, so a `PARAM_MAP`
 * entry pointing at a name the engine does not answer to is accepted and
 * dropped. `density` and `saturation_type` were live, correct and advertised in
 * Rust with nothing in TypeScript able to send them; `early_late` was sent
 * faithfully and swallowed.
 *
 * Both ends are read out of the files production compiles — the state shape
 * from `DEFAULT_PARAMS`, the accepted names from the Rust source — so a
 * parameter added on either side shows up here without anyone editing this
 * file. Per ADR 0015 the population is enumerated, not listed.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');
const PLATE_SOURCE = join(REPO_ROOT, 'crates/proof-chamber/src/proof_chamber.rs');
const INSTANCE_SOURCE = join(REPO_ROOT, 'crates/proof-chamber/src/lib.rs');

/**
 * Keys of the engine state that are not engine parameters.
 *
 * `space` is the preset the panel expanded to produce every other field; it
 * has no engine arm and is deliberately skipped by both dispatch paths.
 */
const NON_ENGINE_KEYS: readonly string[] = ['space'];

/**
 * Parameter names the plate does not answer to, and why that is correct.
 *
 * Asserted in both directions below, so a name that gains a plate arm reds
 * here until its row is deleted rather than sitting in a list forever.
 */
const HANDLED_ABOVE_THE_ENGINE: Readonly<Record<string, string>> = {
    algorithm:
        'Consumed by `ProofChamberInstance::set_param` itself, which rebuilds `self.engine` and returns before ' +
        'forwarding. No individual engine sees it.',
    vintage:
        'Consumed by `ProofChamberInstance::set_param` and applied by `VintageProcessor` after whichever engine ' +
        'rendered, so it is a post-engine stage rather than a plate parameter.',
};

/** Every `"name" =>` and `"a" | "b" =>` arm in a Rust `set_param` match. */
function acceptedParamNames(source: string): ReadonlySet<string> {
    const names = new Set<string>();
    for (const match of source.matchAll(/^\s*((?:"[a-z0-9_]+"\s*\|\s*)*"[a-z0-9_]+")\s*=>/gm)) {
        const [, arm] = match;
        if (!arm) {
            continue;
        }
        for (const quoted of arm.matchAll(/"([a-z0-9_]+)"/g)) {
            const [, name] = quoted;
            if (name) {
                names.add(name);
            }
        }
    }
    return names;
}

const plateNames = acceptedParamNames(readFileSync(PLATE_SOURCE, 'utf8'));
const instanceNames = acceptedParamNames(readFileSync(INSTANCE_SOURCE, 'utf8'));

const engineStateKeys = Object.keys(DEFAULT_PARAMS).filter((key) => !NON_ENGINE_KEYS.includes(key));

describe('Dutch Oven PARAM_MAP closure', () => {
    it('reads a non-trivial set of arms out of the plate source', () => {
        // Guards the regex itself: a pattern that matched nothing would make
        // every "the plate answers to this" assertion below vacuously true.
        expect(plateNames.has('mix')).toBe(true);
        expect(plateNames.size).toBeGreaterThan(15);
    });

    it('gives every engine-state field a wire name', () => {
        const unmapped = engineStateKeys.filter((key) => !PARAM_MAP[key]);

        expect(unmapped).toEqual([]);
    });

    it('points every wire name at something that consumes it', () => {
        const orphans = Object.entries(PARAM_MAP)
            .filter(([, rustName]) => !plateNames.has(rustName))
            .filter(([, rustName]) => !HANDLED_ABOVE_THE_ENGINE[rustName])
            .map(([uiName, rustName]) => `${uiName} -> ${rustName}`);

        expect(orphans).toEqual([]);
    });

    it('keeps the above-the-engine exemptions out of the plate and inside the instance', () => {
        for (const name of Object.keys(HANDLED_ABOVE_THE_ENGINE)) {
            expect({ name, inPlate: plateNames.has(name) }).toEqual({ name, inPlate: false });
            expect({ name, inInstance: instanceNames.has(name) }).toEqual({ name, inInstance: true });
        }
    });

    it('emits the plate-only parameters when a space preset is loaded', () => {
        // `selectSpace` iterates the expanded preset and skips unmapped keys,
        // so a field missing from `PARAM_MAP` never reaches the engine on a
        // preset load either — the path most users take.
        const spaces: readonly SpaceType[] = ['hall', 'plate', 'cathedral'];

        for (const space of spaces) {
            const expanded = expandSpacePreset(space);
            const wireNames = Object.keys(expanded)
                .filter((key) => !NON_ENGINE_KEYS.includes(key))
                .map((key) => PARAM_MAP[key]);

            expect(wireNames).toContain('density');
            expect(wireNames).toContain('saturation_type');
            expect(wireNames).toContain('early_late');
        }
    });
});
