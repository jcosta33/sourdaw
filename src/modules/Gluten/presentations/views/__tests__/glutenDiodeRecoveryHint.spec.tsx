import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type GlutenTopology } from '../../../models/GlutenPatch';
import { type GlutenState } from '../../../stores/glutenStore';
import { GlutenPanel } from '../GlutenPanel';

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
 * release times a restatement gives, in the order it gives them, are the times
 * the Rust `match` maps positions 1 to 5 to.
 *
 * Three sources, all read out of the files that ship, none allowed to vouch for
 * another: the crate's `match` arms, the panel caption, and the manual
 * paragraph at `docs/manual/devices/07-gluten.md`. The manual is included
 * because it restates the same five figures and nothing read it — `rg
 * 'docs/manual' src/` returns only this file — so a retune would have reddened
 * the panel and left the page silently wrong, which is this same defect one
 * document over. A retune that leaves either restatement behind reds, and so
 * does a reword that drops or reorders the numbers in either.
 *
 * The direction words themselves ("spring back", "hold through the tail") stay
 * unasserted. The numbers carry the direction: a reader given an ascending list
 * against ascending positions cannot take low to mean the longer release.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

const DIODE_SOURCE = 'crates/daw-dsp/src/gluten/diode.rs';
const PANEL_SOURCE = 'src/modules/Gluten/presentations/views/GlutenPanel.tsx';
const MANUAL_SOURCE = 'docs/manual/devices/07-gluten.md';

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

/** The figures in one already-anchored run of text, normalised to milliseconds. */
function readFigureRun(run: string): number[] {
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

/**
 * The release times a passage of prose states, normalised to milliseconds.
 *
 * Pure, and separated from the file reads so the reword cases below can
 * exercise it directly, and so the panel caption and the manual paragraph go
 * through one parser rather than two that could drift.
 *
 * Four things it has to survive, because all four occur in prose that is true:
 *
 * - **Figures outside the run.** "Recovery 1 to 5 select fixed release times: …"
 *   names two positions before it names a time. So within a sentence the scrape
 *   starts at the word `release`.
 * - **Sentences before the run.** The manual's paragraph opens "…**Recovery 5**
 *   (default 3) replaces Release on this topology." — a sentence that mentions
 *   release and states no time. So the passage is split into sentences and the
 *   one with the most figures *after* anchoring wins, rather than the first that
 *   says `release`. A sentence boundary is a period followed by whitespace or
 *   end-of-string; not any period, or `1.5` splits mid-number.
 * - **Mixed units.** The manual writes the last figure as `1.5 s`. A guard that
 *   punished the panel for matching the manual's own convention would be a
 *   guard someone deletes rather than fixes, so an `s` figure is × 1000.
 * - **One trailing unit for the whole run.** The shipped caption writes
 *   "50, 100, 400, 800 and 1500 ms" — four bare figures and one unit. So the
 *   unit is optional per figure, and a bare figure inherits from the next
 *   figure that names one. That is why this is not simply
 *   `/(\d+(?:\.\d+)?)\s*(ms|s)\b/g`: requiring a unit on every figure would
 *   read the shipped caption as the single number 1500.
 */
function readReleaseSentenceRuns(prose: string): number[][] {
    const text = prose.replaceAll(/\s+/g, ' ');
    const runs: number[][] = [];

    for (const sentence of text.split(/\.(?=\s|$)/)) {
        const start = sentence.search(/release/i);
        if (start === -1) {
            continue;
        }
        runs.push(readFigureRun(sentence.slice(start)));
    }

    return runs;
}

function parseHintReleaseTimes(prose: string): number[] {
    let best: number[] = [];
    for (const run of readReleaseSentenceRuns(prose)) {
        if (run.length > best.length) {
            best = run;
        }
    }
    return best;
}

/**
 * Release times a passage states out of the engine's order, sentence by
 * sentence.
 *
 * Picking the highest-count sentence and comparing only that one is not enough,
 * and the gap is not theoretical — this paragraph passed an exact comparison
 * against the engine map:
 *
 * > …replaces Release on this topology. Position 1 holds the longest release,
 * > 1500 ms, and position 5 snaps back fastest at 50 ms. The five fixed release
 * > times are 50 ms, 100 ms, 400 ms, 800 ms, and 1.5 s.
 *
 * The five-figure sentence wins the count and matches; the two-figure sentence
 * says position 1 is the *slowest*, which is the defect this file exists to
 * remove, and it was thrown away unread.
 *
 * So every `release`-bearing sentence is checked, not just the winner. The
 * claim is per sentence and weaker than equality on purpose: of the figures a
 * sentence states that the engine also states, they must appear in the engine's
 * own order. A sentence naming one time ("Recovery 3 is 400 ms") passes
 * trivially; "position 1 … 1500 ms … position 5 … 50 ms" states 1500 before 50
 * and fails; "position 1 … 50 ms … position 5 … 1500 ms" states the same
 * pairing correctly and passes. Non-map figures — position numbers, defaults,
 * counts — are ignored, so ordinary prose is not policed.
 */
function readMisorderedReleaseFigures(prose: string, engineMap: readonly number[]): number[][] {
    const misordered: number[][] = [];

    for (const run of readReleaseSentenceRuns(prose)) {
        const stated = run.filter((figure) => engineMap.includes(figure));
        const inEngineOrder = [...stated].sort((left, right) => engineMap.indexOf(left) - engineMap.indexOf(right));
        if (stated.join() !== inEngineOrder.join()) {
            misordered.push(stated);
        }
    }

    return misordered;
}

/** The caption the panel prints under the Recovery chips, as source text. */
function readHintProse(): string {
    const source = readSource(PANEL_SOURCE);
    const chips = source.indexOf('`Recovery ${value}`');
    if (chips === -1) {
        return '';
    }

    return /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(source.slice(chips))?.[1] ?? '';
}

/** The release times the shipped Recovery hint states, in the order it states them. */
function readHintReleaseTimes(): number[] {
    return parseHintReleaseTimes(readHintProse());
}

/**
 * The release times the user manual states, in the order it states them.
 *
 * The third source. The manual restates the same five figures as prose, and
 * until now nothing read it — `rg 'docs/manual' src/` returns only this file —
 * so an engine retune would have reddened the panel and left the manual
 * silently wrong. That is the same failure this PR exists to clean up after,
 * one document over.
 *
 * The paragraph is found by the `**Recovery 1**` marker rather than by line
 * number, so reflowing the prose or moving the section does not break the read.
 */
function readManualProse(): string {
    return (
        readSource(MANUAL_SOURCE)
            .split(/\n\s*\n/)
            .find((block) => block.includes('**Recovery 1**')) ?? ''
    );
}

function readManualReleaseTimes(): number[] {
    return parseHintReleaseTimes(readManualProse());
}

// ── The rendered surface ─────────────────────────────────────────────────────

/**
 * The caption is guarded above as *file text*. That is one edit away from being
 * a lie: gate the Diode branch on something unreachable, or drop the caption
 * out of the rendered tree, and every assertion above stays green while no user
 * ever sees it. `GlutenPanel.spec.tsx` does not close this — it has four
 * `it`s, none mentioning `diode`, `Recovery` or `topology`, and the default
 * patch is `topology: 'vca'`, so the Diode branch executes in no spec at all.
 *
 * So: render it, on both sides of the gate.
 */
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => {
        if (typeof defaultValue === 'object' && defaultValue !== null && 'tracks' in defaultValue) {
            return defaultValue;
        }
        return MOCKED_INSTANCES;
    }),
}));

const DEVICE_ID = 'gluten-recovery-hint-device';

let MOCKED_INSTANCES: Record<string, GlutenState> = {};

function renderPanelWithTopology(topology: GlutenTopology): void {
    MOCKED_INSTANCES = {
        [DEVICE_ID]: { patch: { ...DEFAULT_PATCH, topology }, uiLevel: 2 },
    };
    render(<GlutenPanel deviceId={DEVICE_ID} />);
}

/**
 * The release runs the rendered page actually shows, one per paragraph.
 *
 * Read off the DOM rather than the source, and scoped to paragraphs so the
 * Release *knob* — which is not topology-gated, and whose readout is a number
 * beside the word "Release" — cannot be mistaken for a stated release map.
 */
function readRenderedReleaseRuns(): number[][] {
    return [...document.querySelectorAll('p')]
        .map((paragraph) => parseHintReleaseTimes(paragraph.textContent))
        .filter((run) => run.length > 0);
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

    it('reads the manual paragraph that restates the map', () => {
        // And on the manual side. A moved section or a renamed heading yields
        // an empty list, which would otherwise make the comparison below pass
        // by comparing nothing to nothing.
        expect(readManualReleaseTimes().length).toBeGreaterThanOrEqual(5);
    });

    it('prints the same times, in the same order, the engine maps positions 1 to 5 to', () => {
        // The ordering claim itself. Position 1 is the *fastest* release, so an
        // ascending list is what makes the hint true; the old copy claimed the
        // reverse and this is the assertion that would have caught it.
        expect(readHintReleaseTimes()).toEqual(readEngineReleaseMap());
    });

    it('states the same times in the manual as the engine maps positions 1 to 5 to', () => {
        // Third source, same claim. The manual is what a user reads when the
        // panel caption is not in front of them, and it is the one restatement
        // no code had a reason to open. An engine retune now reds here too
        // instead of leaving the page quietly wrong.
        expect(readManualReleaseTimes()).toEqual(readEngineReleaseMap());
    });

    it('states no release time out of position in any sentence of either source', () => {
        // The union, not the winner. Comparing only the sentence with the most
        // figures throws away every other sentence — including one that pairs a
        // position with a time — so a passage can state the map correctly in
        // one breath and invert it in the next and still pass.
        const engineMap = readEngineReleaseMap();

        expect(readMisorderedReleaseFigures(readHintProse(), engineMap)).toEqual([]);
        expect(readMisorderedReleaseFigures(readManualProse(), engineMap)).toEqual([]);
    });

    it('catches a passage whose losing sentence inverts the map', () => {
        // The exact paragraph that passed the winner-only comparison 7/7. Its
        // middle sentence says position 1 is the slowest, which is the defect
        // this file exists to remove.
        const engineMap = readEngineReleaseMap();
        const inverted =
            '**Diode** — **Recovery 1** to **Recovery 5** replaces Release on this topology. ' +
            'Position 1 holds the longest release, 1500 ms, and position 5 snaps back fastest at 50 ms. ' +
            'The five fixed release times are 50 ms, 100 ms, 400 ms, 800 ms, and 1.5 s.';

        // Still passes the winner-only check — which is why that check alone
        // was not enough.
        expect(parseHintReleaseTimes(inverted)).toEqual(engineMap);
        expect(readMisorderedReleaseFigures(inverted, engineMap)).toEqual([[1500, 50]]);
    });

    it('permits a sentence that pairs positions with times correctly', () => {
        // The same shape stated truthfully has to pass, or the check is just a
        // ban on mentioning two times in one sentence.
        const engineMap = readEngineReleaseMap();
        const correct =
            'Position 1 snaps back fastest at 50 ms, and position 5 holds the longest release, 1500 ms. ' +
            'The five fixed release times are 50 ms, 100 ms, 400 ms, 800 ms, and 1.5 s.';

        expect(readMisorderedReleaseFigures(correct, engineMap)).toEqual([]);
        expect(parseHintReleaseTimes(correct)).toEqual(engineMap);
    });

    it('survives rewordings that leave the claim true', () => {
        // The point of guarding the ordering rather than the prose is that copy
        // can move. These are the edits that used to red: naming the positions
        // before the times put 1 and 5 in the list, and matching the manual's
        // own unit convention put 1.5 in it. Both are pinned here so the
        // tolerance cannot be lost again without a test saying so.
        //
        // These stay literals even though the manual is now read for real. They
        // pin the *parser*, not the page: the second is a form the manual could
        // move away from tomorrow, and the tolerance for it should outlive
        // whatever the manual currently happens to say.
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

    it('renders the caption on Diode, carrying the engine’s times', () => {
        // Present, and routed: not "a caption exists" but "the caption a user
        // sees states the map the engine runs". The Recovery chips are the
        // gate's other half — they and the caption stand or fall together.
        renderPanelWithTopology('diode');

        expect(screen.getByText('Recovery 1')).toBeTruthy();
        expect(readRenderedReleaseRuns()).toEqual([readEngineReleaseMap()]);
    });

    it('renders neither the chips nor the caption on the default topology', () => {
        // Absent. Without this the present-case would pass on a panel that
        // rendered the caption unconditionally, which is a different bug and
        // would make the Recovery copy visible under VCA, FET and Opto where it
        // is false.
        renderPanelWithTopology(DEFAULT_PATCH.topology);

        expect(DEFAULT_PATCH.topology).not.toBe('diode');
        expect(screen.queryByText('Recovery 1')).toBeNull();
        expect(readRenderedReleaseRuns()).toEqual([]);
    });
});
