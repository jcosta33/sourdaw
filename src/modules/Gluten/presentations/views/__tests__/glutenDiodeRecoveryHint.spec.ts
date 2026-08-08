import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The Diode topology's Recovery hint used to say the opposite of what the
 * engine does.
 *
 * `DiodeCompressor::update_coeffs` (`crates/daw-dsp/src/gluten/diode.rs`) maps
 * the five Recovery positions to *fixed* release times — 50, 100, 400, 800 and
 * 1500 ms — so position 1 is the **fastest** release: the level springs back
 * between hits and the least gain reduction is held. Position 5 holds reduction
 * through the tail and pumps most. The panel printed "Lower values grab harder.
 * Higher values relax into the tail", which reads the ordering backwards, and
 * `docs/manual/devices/07-gluten.md` carried a standing correction telling
 * readers to ignore it.
 *
 * ## What this guards, and what it deliberately does not
 *
 * Not the prose. A string assertion on caption copy breaks on every reword and
 * guards nothing about behaviour. What is asserted is the *ordering claim*: the
 * release times the hint prints, in the order it prints them, are the times the
 * Rust `match` maps positions 1 to 5 to. Both sides are read out of the files
 * that ship — the hint from the panel source, the map from the crate — so a
 * retune of the engine that leaves the caption behind reds here, and so does a
 * reword that drops or reorders the numbers.
 *
 * The direction words themselves ("spring back", "hold through the tail") stay
 * unasserted. The numbers carry the direction: a reader given an ascending list
 * against ascending positions cannot take low to mean the longer release.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

const DIODE_SOURCE = 'crates/daw-dsp/src/gluten/diode.rs';
const PANEL_SOURCE = 'src/modules/Gluten/presentations/views/GlutenPanel.tsx';

function readSource(relativePath: string): string {
    return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** The release time each Recovery position maps to, in position order. */
function readEngineReleaseMap(): number[] {
    const source = readSource(DIODE_SOURCE);
    const block = /let release_ms = match self\.recovery \{([\s\S]*?)\};/.exec(source);
    if (block === null) {
        return [];
    }

    const arms = [...block[1]!.matchAll(/^\s*(\d+)\s*=>\s*(\d+(?:\.\d+)?),/gm)];
    return arms
        .map((arm) => ({ position: Number(arm[1]!), releaseMs: Number(arm[2]!) }))
        .sort((left, right) => left.position - right.position)
        .map((arm) => arm.releaseMs);
}

/** The millisecond figures the Recovery hint prints, in the order it prints them. */
function readHintReleaseTimes(): number[] {
    const source = readSource(PANEL_SOURCE);
    const chips = source.indexOf('`Recovery ${value}`');
    if (chips === -1) {
        return [];
    }

    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(source.slice(chips));
    if (paragraph === null) {
        return [];
    }

    return [...paragraph[1]!.matchAll(/\d+(?:\.\d+)?/g)].map((figure) => Number(figure[0]));
}

describe('the Diode Recovery hint states the release map the engine runs', () => {
    it('reads five release arms out of the engine', () => {
        // Vacuity guard on the Rust side. A refactor that renames the match or
        // moves it into a table yields an empty list, and every comparison
        // below would then pass by comparing nothing.
        const releaseMap = readEngineReleaseMap();

        expect(releaseMap).toHaveLength(5);
        expect(releaseMap).toEqual([...releaseMap].sort((left, right) => left - right));
    });

    it('reads the hint paragraph the Recovery chips print', () => {
        // The same guard on the panel side.
        expect(readHintReleaseTimes().length).toBeGreaterThanOrEqual(5);
    });

    it('prints the same times, in the same order, the engine maps positions 1 to 5 to', () => {
        // The ordering claim itself. Position 1 is the *fastest* release, so an
        // ascending list is what makes the hint true; the old copy claimed the
        // reverse and this is the assertion that would have caught it.
        expect(readHintReleaseTimes()).toEqual(readEngineReleaseMap());
    });
});
