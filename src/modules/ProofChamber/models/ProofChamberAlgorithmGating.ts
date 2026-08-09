import {
    DUTCH_OVEN_ENGINE_BY_WIRE_VALUE,
    findNativeDspEngineGapParam,
    type NativeDspEngineGapParam,
} from '#/utils/nativeDspEngineGaps';

import {
    ALGORITHM_MAP,
    PARAM_MAP,
    PROOF_CHAMBER_DECAY_EQ_BANDS,
    type ProofChamberAlgorithm,
    type ProofChamberEngineState,
} from './ProofChamberState';

/** Display names for the algorithm selector, and for anything that has to name one in prose. */
export const ALGORITHM_LABELS: Record<ProofChamberAlgorithm, string> = {
    plate: 'Plate',
    'fdn-8': 'FDN 8',
    'fdn-16': 'FDN 16',
    spring: 'Spring',
    reverse: 'Reverse',
};

/**
 * Which reverb engine an algorithm selection runs.
 *
 * Two algorithms share one engine — FDN 8 and FDN 16 are both `FdnReverb` with
 * a different matrix order — so the panel cannot use the algorithm id as the
 * gap table's key. It goes through the wire value, which is what the Rust
 * dispatch switches on, and `descriptorEngineParamWeld.spec.ts` welds that map
 * to the dispatch it scans out of `lib.rs`.
 */
export function chamberEngineIdForAlgorithm(algorithm: ProofChamberAlgorithm): string {
    const wireValue = ALGORITHM_MAP[algorithm];
    return DUTCH_OVEN_ENGINE_BY_WIRE_VALUE[wireValue] ?? 'plate';
}

/**
 * Whether a control is worth offering on the live algorithm, and what to say
 * when it is not.
 *
 * `kind` is `null` exactly when `isInert` is false. `structural` means the
 * parameter is a category error on this topology and no DSP will close it;
 * `unbuilt` means the stage has not been written yet, so the control comes back
 * on its own the day the gap table loses the row.
 */
export type ChamberControlGate = {
    readonly isInert: boolean;
    readonly kind: 'structural' | 'unbuilt' | null;
    /** A full sentence naming the algorithm and the reason, or null when the control is live. */
    readonly explanation: string | null;
};

const LIVE: ChamberControlGate = { isInert: false, kind: null, explanation: null };

/**
 * ## Why a disabled control says nothing about what happens later
 *
 * An earlier version of this file ended every explanation with *"Automation
 * already drawn for it is kept and plays again on an algorithm that reads it"*,
 * rendered into the `title` of up to fifteen controls per algorithm. It was
 * false when it was written. `ProofChamberInstance::set_param` constructed a
 * **new** engine when `algorithm` arrived and replayed nothing into it, so
 * switching algorithm reset every parameter on the device — measured plate →
 * reverse → plate as bit-identical to an engine nobody had ever written to.
 *
 * That was this change's original sin: taking a silent engine defect and
 * converting it into an explicit written promise. A panel-side replay was then
 * written to make the promise true, and removed once measurement showed it
 * cannot work at that layer — see `selectAlgorithm` for why the two required
 * fixes are contradictory.
 *
 * **The rule this file now follows: say what the control's state is and why it
 * is in that state, and nothing about what happens later.** Replacing a false
 * promise with a weaker promise the engine also breaks would repeat the same
 * mistake in miniature.
 *
 * The `ProofChamberInstance` parameter cache has since landed, and
 * `crates/proof-chamber/tests/algorithm_switch_parameter_retention.rs` proves
 * by render delta that values survive a switch on every exposed engine. **The
 * sentence is still not coming back.** It was dropped rather than softened
 * exactly so that the next version of it has to be earned by something true,
 * and "everything survives" is still not true: the plate latches `shimmer` off
 * inside its `freeze` arm and a cache of values cannot re-fire a latch, which
 * that test file pins as a measured exception. A promise with an asterisk in
 * fifteen tooltips is the same mistake as the original, one size smaller.
 *
 * What could be said without an asterisk — *a value you set on one algorithm
 * is there when you come back to it* — is a copy change on its own evidence,
 * not a rider on an engine fix, and it waits until the plate's latch is
 * settled one way or the other.
 *
 * What is true today and needs no promise in the UI: gating refuses manual
 * entry and nothing else. The descriptor's `automatable` flag, the automation
 * lane picker, the stored `parameterValues` and any curve a project has drawn
 * are all untouched by it.
 *
 * Three alternatives were considered and rejected:
 *
 * 1. **Clear the lane on switch.** Rejected outright. It destroys work the user
 *    cannot get back, and switching back is the *normal* reason to switch away.
 *    Both plug-in formats that have an opinion agree: VST3 forbids a plug-in
 *    reconfiguring itself into a different set of automatable parameters and
 *    warns that removing a parameter loses automation data; CLAP requires
 *    parameter ids to *"never change"* and marks a currently-unused parameter
 *    hidden rather than deleting it. A mode switch may change what a parameter
 *    does, never whether it exists.
 * 2. **Drop the parameter from the automatable surface while inert.** Same
 *    objection one layer down, and it is the manoeuvre VST3 names as
 *    out-of-spec. It would also make an existing lane un-editable rather than
 *    merely inaudible.
 * 3. **Leave the control interactive, because the automation is real.** This is
 *    a genuine position — FabFilter Pro-R ships mode-inert controls fully live
 *    and explains them only in the manual — and it is what this panel did until
 *    now. Rejected because it is indistinguishable from the bug: a user turning
 *    a knob and hearing nothing has no way to tell "inert on this algorithm"
 *    from "broken". The disabled state plus its explanation carries that
 *    information; a live knob carries none.
 *
 * The chosen shape is the one Nielsen's review of inactive controls recommends
 * (show disabled, keep the layout stable, and say why) and the one Eventide's
 * SP2016 ships for the same situation. It is a product call rather than a
 * technical one, and it is the part of this change most worth a second opinion.
 */

export type ChamberControlGateInput = {
    readonly algorithm: ProofChamberAlgorithm;
    readonly paramKey: keyof ProofChamberEngineState;
    /** The control's visible label, so the explanation names what the user is pointing at. */
    readonly controlLabel: string;
};

/**
 * Why both populations are gated, and how a reader tells them apart.
 *
 * `structural` and `unbuilt` are different facts about the *product*, and they
 * are deliberately given the same *interactivity* and different *words*.
 *
 * Same interactivity, because the user's experience is identical: the knob
 * turns, the automation lane records and persists, and the DSP never hears it.
 * That is the defect regardless of which reason produced it, and leaving the
 * ten unbuilt rows live to preserve the distinction would leave the panel lying
 * about ten controls in order to be honest about five. Eventide's SP2016 — the
 * closest shipping precedent — greys out Position, Diffusion and EQ on its
 * vintage plate for a reason squarely in the `unbuilt` family (those stages
 * were not present in the original algorithm), so the precedent covers this
 * case rather than only the category errors.
 *
 * Different words, because "not implemented yet" and "does not apply" tell the
 * user different things about where the product is going, and only one of them
 * should ever stop being true. A reader tells them apart three ways, none of
 * which is a comment:
 *
 * - in the table, by `kind` on the row (`NATIVE_DSP_ENGINE_GAPS`);
 * - in the panel, by the sentence — `unbuilt` says "yet";
 * - over time, by what happens: an `unbuilt` row is deleted the day the DSP
 *   lands, and `descriptorEngineParamWeld.spec.ts` reds until it is, which
 *   re-enables the control here with no edit. A `structural` row cannot be
 *   retired that way, because no arm will ever appear for it.
 *
 * The one shape this must never take is a `structural` row invented to silence
 * a control nobody wants to build. Every one of them carries cited research in
 * `NATIVE_DSP_ENGINE_GAPS`; a row without a reason reds in the weld spec.
 */
function explain({
    gap,
    controlLabel,
    algorithmLabel,
}: {
    gap: NativeDspEngineGapParam;
    controlLabel: string;
    algorithmLabel: string;
}): string {
    if (gap.kind === 'structural') {
        return `${controlLabel} does not apply to the ${algorithmLabel} algorithm. ${gap.note}`;
    }
    return `${controlLabel} is not implemented on the ${algorithmLabel} algorithm yet, so this engine ignores it.`;
}

/**
 * Resolve one panel control against the engine-gap census.
 *
 * The population is derived, never enumerated here: the parameter is translated
 * to the id the engine matches on through the same `PARAM_MAP` the panel writes
 * with, and looked up in `NATIVE_DSP_ENGINE_GAPS`. A gap closed in Rust deletes
 * its row — the weld spec reds until it does — and the control becomes live
 * again with no edit to this file or to the panel.
 */
export function chamberControlGate({ algorithm, paramKey, controlLabel }: ChamberControlGateInput): ChamberControlGate {
    const paramId = PARAM_MAP[paramKey];
    if (paramId === undefined) {
        return LIVE;
    }

    const gap = findNativeDspEngineGapParam({
        deviceId: 'dutch-oven',
        engineId: chamberEngineIdForAlgorithm(algorithm),
        paramId,
    });
    if (gap === null) {
        return LIVE;
    }

    return {
        isInert: true,
        kind: gap.kind,
        explanation: explain({ gap, controlLabel, algorithmLabel: ALGORITHM_LABELS[algorithm] }),
    };
}

/**
 * The `decay` at or above which the Dutch Oven's Decay Rate EQ has no per-pass
 * loss left to redistribute, per algorithm.
 *
 * ## What the numbers are, and why there is only one
 *
 * The stage is *relative*: a decay multiplier asks for a fraction of what the
 * loop already loses on each pass, so a loop that loses almost nothing has
 * almost nothing to give. `crates/proof-chamber/src/decay_eq.rs` refuses to
 * boost past `LIMIT_MARGIN_DB` below unity, and below `MIN_DESIGNABLE_GAIN_DB`
 * of shaping it makes each section an exact pass-through. The refusal is
 * correct — the alternative is a reverb whose tail grows — but it is total and
 * silent, and a user dragging six nodes and hearing nothing cannot tell it from
 * a broken control.
 *
 * **Only the plate has a row, and it was measured rather than derived.** The
 * arithmetic for a *flat* loop puts the floor at a `decay` of about 0.995, and
 * that is wrong for every real engine, because every one of them has a damping
 * filter in the same loop that takes far more per pass at high frequencies than
 * at low ones. So the upper bands keep working long after the low ones stop,
 * and the stage does not go fully silent until the whole curve has nothing:
 *
 * - plate — `decay^2` per half-traversal, silent at 0.999 and shaping at 0.998;
 * - FDN 8 / FDN 16 — measured shaping at 0.999, because their absorption is a
 *   fraction of RT60 rather than a fixed dB and keeps opening headroom above
 *   2 kHz. No row;
 * - spring — `feedback` is clamped at 0.95, which is 0.446 dB of loss, an order
 *   of magnitude above the floor. No row.
 *
 * `crates/proof-chamber/tests/decay_eq_parameter_surface.rs`'s
 * `the_top_of_the_decay_range_stops_shaping_rather_than_shaping_weakly` is the
 * measurement — it renders the plate at 0.999 and requires bit-identity with
 * never writing the bands, and requires 0.99 to still differ.
 * `proofChamberDecayEqHeadroom.spec.ts` welds this declaration to it, so a
 * ceiling that stops matching the engine reds rather than drifting.
 *
 * Reading `DecayRateEq::design_gains_db` back from the worklet would be better
 * than any of this. It needs a worklet-to-panel channel that does not exist;
 * this is the interim, declared where a browser can read it and checked against
 * the engine by a spec — the same shape as `DUTCH_OVEN_ENGINE_BY_WIRE_VALUE`.
 */
export const DECAY_EQ_HEADROOM_CEILING: Partial<Record<ProofChamberAlgorithm, number>> = {
    plate: 0.999,
};

export type ChamberDecayEqGateInput = {
    readonly algorithm: ProofChamberAlgorithm;
    readonly freeze: boolean;
    readonly decay: number;
};

/**
 * Whether the Decay Rate EQ can do anything at the current settings.
 *
 * Three ways it cannot, and they are deliberately different sentences because
 * they are different facts about the product:
 *
 * - the algorithm has no recirculating loop at all (Reverse) — the engine-gap
 *   census answers this, and it is the same `structural` row every other dead
 *   control on that algorithm uses;
 * - `freeze` holds the tank at unity, so there is no decay rate for a
 *   multiplier to be relative to. This one is exact rather than a threshold:
 *   `ProofChamber::process` sets `target_decay = 1.0` under freeze, which is
 *   zero loss by construction. It is also the reachable one — a chip beside the
 *   Decay EQ chip;
 * - `decay` is at the top of its travel, where what the loop loses per pass is
 *   below the stage's own margin.
 */
export function chamberDecayEqGate({ algorithm, freeze, decay }: ChamberDecayEqGateInput): ChamberControlGate {
    const structural = chamberControlGate({
        algorithm,
        paramKey: PROOF_CHAMBER_DECAY_EQ_BANDS[0],
        controlLabel: 'Decay EQ',
    });
    if (structural.isInert) {
        return structural;
    }

    if (freeze) {
        return {
            isInert: true,
            kind: 'structural',
            explanation:
                'Decay EQ does nothing while Freeze is engaged. Freeze holds the tank at unity gain, so the tail ' +
                'never decays and there is no decay rate for a per-band multiplier to be relative to.',
        };
    }

    const ceiling = DECAY_EQ_HEADROOM_CEILING[algorithm];
    if (ceiling !== undefined && decay >= ceiling) {
        return {
            isInert: true,
            kind: 'structural',
            explanation:
                `Decay EQ does nothing at a Decay of ${ceiling} or above on the ${ALGORITHM_LABELS[algorithm]} ` +
                'algorithm. The curve asks for a share of what the tail already loses on each pass, and at the top ' +
                'of the Decay range it loses less than the shaping would add. Turn Decay down to use it.',
        };
    }

    return LIVE;
}
