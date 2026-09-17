import { logger } from '#/infra/logger/appLogger';

import { type BacteriaModAssignment } from './BacteriaPatch';

/**
 * The string → numeric-id grammar for the engine's modulation matrix
 * (`BacteriaInstance::add_mod_assignment` in `crates/daw-dsp/src/bacteria/mod.rs`).
 *
 * The patch model spells assignments in UI ids (`BacteriaModAssignment`), the
 * wasm boundary takes small integers. Mapping lives here — in the bridge, not
 * in the node — so the worklet protocol stays numeric and the grammar has one
 * definition beside the amount scaling it needs.
 */

/**
 * Source ids per the engine's table: 0=LFO1, 1=LFO2, 2=envelope follower,
 * 3=Lorenz X, 4=Lorenz Z, 5=step sequencer, 6-13=macros 1-8. The dock offers a
 * subset; macros 5-8 are mapped anyway so a hand-edited or future patch source
 * is not silently dropped.
 */
const MOD_SOURCE_IDS: Readonly<Record<string, number>> = {
    lfo1: 0,
    lfo2: 1,
    env: 2,
    lorenz: 3,
    lorenzZ: 4,
    stepseq: 5,
    macro1: 6,
    macro2: 7,
    macro3: 8,
    macro4: 9,
    macro5: 10,
    macro6: 11,
    macro7: 12,
    macro8: 13,
};

/** Band-module slot ids inside a band's 16-slot stride: drive, then filter cutoff. */
const BAND_MODULE_BASE = 16;
const BAND_MODULE_STRIDE = 16;
const BAND_MOD_DRIVE = 0;
const BAND_MOD_FILTER_CUTOFF = 1;
const MAX_BANDS = 6;

/** A numeric assignment table entry, spelled the way the wasm boundary takes it. */
export type NumericBacteriaModAssignment = { sourceId: number; targetParam: number; amount: number };

/** How much of a target's usable range one unit of UI depth sweeps, in the offset units the engine adds. */
const MODULATION_TARGET_RANGE: Readonly<Record<string, number>> = {
    mix: 1, // 0–1
    gain: 1, // linear; the band-gain offset adds to the smoothed linear gain
    drive: 100, // the knob's own 0–100
    filterCutoff: 19_980, // 20 Hz–20 kHz
};

export function bacteriaModSourceId(sourceId: string): number | null {
    return MOD_SOURCE_IDS[sourceId] ?? null;
}

/**
 * Map one `targetParam` id to the engine's numeric target.
 *
 * Grammar: `mix`, `band{N}_gain`, and the per-band module slots `band{N}_drive`
 * and `band{N}_filterCutoff` for N in 0-5. Anything else — a legacy bare
 * `drive`, an unknown name, a band past the engine's six — maps to `null`
 * rather than to a nearest guess: an assignment must not silently retarget.
 */
export function bacteriaModTargetId(targetParam: string): number | null {
    if (targetParam === 'mix') {
        return 0;
    }
    const bandMatch = /^band([0-5])_(gain|drive|filterCutoff)$/.exec(targetParam);
    if (!bandMatch) {
        return null;
    }
    const band = Number(bandMatch[1]);
    if (!Number.isInteger(band) || band >= MAX_BANDS) {
        return null;
    }
    switch (bandMatch[2]) {
        case 'gain':
            return 1 + band;
        case 'drive':
            return BAND_MODULE_BASE + band * BAND_MODULE_STRIDE + BAND_MOD_DRIVE;
        case 'filterCutoff':
            return BAND_MODULE_BASE + band * BAND_MODULE_STRIDE + BAND_MOD_FILTER_CUTOFF;
        default:
            return null;
    }
}

function targetFamily(targetParam: string): string | null {
    if (targetParam === 'mix') {
        return 'mix';
    }
    const bandMatch = /^band[0-5]_(gain|drive|filterCutoff)$/.exec(targetParam);
    return bandMatch?.[1] ?? null;
}

/**
 * Map a whole UI assignment table into engine ids, scaling each amount from a
 * fraction of the target's usable range into the offset units the engine adds.
 * Returns `null` when any row is unmappable: the table is applied as one
 * replacement (clear-then-re-add), so a partially mapped table would leave the
 * engine describing a routing the store does not hold.
 */
export function mapBacteriaModAssignments(assignments: BacteriaModAssignment[]): NumericBacteriaModAssignment[] | null {
    const mapped: NumericBacteriaModAssignment[] = [];
    for (const assignment of assignments) {
        const sourceId = bacteriaModSourceId(assignment.sourceId);
        const targetId = bacteriaModTargetId(assignment.targetParam);
        const family = targetFamily(assignment.targetParam);
        const range = family === null ? undefined : MODULATION_TARGET_RANGE[family];
        if (sourceId === null || targetId === null || range === undefined) {
            logger.warn(
                `[bacteriaParamBridge] mapBacteriaModAssignments: no engine mapping for source "${assignment.sourceId}" ` +
                    `→ target "${assignment.targetParam}"; the whole table was not pushed.`
            );
            return null;
        }
        mapped.push({ sourceId, targetParam: targetId, amount: assignment.amount * range });
    }
    return mapped;
}

/** One selectable target in the dock's add flow, with its display label. */
export type BacteriaModulationTargetChoice = { id: string; label: string };

/**
 * The targets the dock's add flow offers: global mix plus each active band's
 * drive and filter cutoff. Per-band gain is deliberately absent — its engine
 * offset is linear and the panel knob is dB, so a depth slider would not mean
 * what its label says until that unit question is settled.
 */
export function bacteriaModulationTargetChoices(bandCount: number): BacteriaModulationTargetChoice[] {
    const choices: BacteriaModulationTargetChoice[] = [{ id: 'mix', label: 'Master Mix' }];
    const bands = Math.max(0, Math.min(bandCount, MAX_BANDS));
    for (let band = 0; band < bands; band++) {
        choices.push({ id: `band${band}_drive`, label: `Band ${band + 1} Drive` });
        choices.push({ id: `band${band}_filterCutoff`, label: `Band ${band + 1} Cutoff` });
    }
    return choices;
}
