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

/**
 * The release times a hint sentence states, normalised to milliseconds.
 *
 * Pure, and separated from the file read so the reword cases below can exercise
 * it directly. Three things it has to survive, because all three are edits a
 * copy editor could reasonably make while leaving the claim true:
 *
 * - **Figures outside the run.** "Recovery 1 to 5 select fixed release times: …"
 *   names two positions before it names a time. So the scrape is anchored: it
 *   starts at the word `release` and stops at the end of that sentence, and a
 *   sentence end is a period followed by space or end-of-string — not any
 *   period, or `1.5` would truncate it.
 * - **Mixed units.** `docs/manual/devices/07-gluten.md:145` writes the last
 *   figure as `1.5 s`. A guard that punished the panel for matching the
 *   manual's own convention would be a guard someone deletes rather than fixes,
 *   so an `s` figure is multiplied by 1000.
 * - **One trailing unit for the whole run.** The shipped caption writes
 *   "50, 100, 400, 800 and 1500 ms" — four bare figures and one unit. So the
 *   unit is optional per figure, and a bare figure inherits from the next
 *   figure that names one. That is why this is not simply
 *   `/(\d+(?:\.\d+)?)\s*(ms|s)\b/g`: requiring a unit on every figure would
 *   read the shipped caption as a single number.
 */
function parseHintReleaseTimes(sentence: string): number[] {
    const text = sentence.replaceAll(/\s+/g, ' ');
    const start = text.search(/release/i);
    if (start === -1) {
        return [];
    }

    const fromRun = text.slice(start);
    const sentenceEnd = fromRun.search(/\.(?=\s|$)/);
    const run = sentenceEnd === -1 ? fromRun : fromRun.slice(0, sentenceEnd);

    const figures = [...run.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s)?\b/g)].map((figure) => ({
        value: Number(figure[1]!),
        unit: figure[2],
    }));

    // Walk backwards so a bare figure takes the unit of the next one that names
    // a unit — the trailing-unit convention. Milliseconds when none is named at
    // all, which is what the crate speaks.
    const milliseconds: number[] = [];
    let inherited = 'ms';
    for (let index = figures.length - 1; index >= 0; index -= 1) {
        const figure = figures[index]!;
        const unit = figure.unit ?? inherited;
        inherited = unit;
        milliseconds.unshift(unit === 's' ? figure.value * 1000 : figure.value);
    }

    return milliseconds;
}

/** The release times the shipped Recovery hint states, in the order it states them. */
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

    return parseHintReleaseTimes(paragraph[1]!);
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

    it('survives rewordings that leave the claim true', () => {
        // The point of guarding the ordering rather than the prose is that copy
        // can move. These are the edits that used to red: naming the positions
        // before the times put 1 and 5 in the list, and matching the manual's
        // own unit convention put 1.5 in it. Both are pinned here so the
        // tolerance cannot be lost again without a test saying so.
        const engineMap = readEngineReleaseMap();

        expect(
            parseHintReleaseTimes(
                'Recovery 1 to 5 select fixed release times: 50, 100, 400, 800 and 1500 ms. Low positions let the level spring back between hits.'
            )
        ).toEqual(engineMap);

        expect(
            parseHintReleaseTimes(
                'Each position is a fixed release time: 50 ms, 100 ms, 400 ms, 800 ms, and 1.5 s. High positions hold the reduction through the tail.'
            )
        ).toEqual(engineMap);

        expect(
            parseHintReleaseTimes('Release: 0.05 s, 0.1 s, 0.4 s, 0.8 s and 1.5 s across the five positions.')
        ).toEqual(engineMap);
    });

    it('still catches a reworded caption that states the wrong order', () => {
        // The other half of loosening the scrape: tolerance must not become
        // blindness. Each of these is well-formed prose the parser now reads
        // cleanly, and each states something the engine does not do.
        const engineMap = readEngineReleaseMap();

        // The defect this PR fixes, dressed in the new wording.
        expect(parseHintReleaseTimes('Recovery 1 to 5 sets release times: 1500, 800, 400, 100 and 50 ms.')).not.toEqual(
            engineMap
        );

        // A retune the caption did not follow.
        expect(parseHintReleaseTimes('Recovery 1 to 5 sets release times: 50, 100, 300, 800 and 1500 ms.')).not.toEqual(
            engineMap
        );

        // Right numbers, wrong unit — 50 s is not 50 ms.
        expect(parseHintReleaseTimes('Release times: 50, 100, 400, 800 and 1500 s.')).not.toEqual(engineMap);
    });
});
