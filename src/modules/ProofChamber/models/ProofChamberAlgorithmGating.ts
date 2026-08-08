import {
    DUTCH_OVEN_ENGINE_BY_WIRE_VALUE,
    findNativeDspEngineGapParam,
    type NativeDspEngineGapParam,
} from '#/utils/nativeDspEngineGaps';

import {
    ALGORITHM_MAP,
    PARAM_MAP,
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
 * The clause every disabled control ends with.
 *
 * ## What happens to a lane already drawn when the algorithm changes: nothing
 *
 * Gating refuses *manual* entry and nothing else. It does not touch the
 * descriptor's `automatable` flag, the automation lane picker, the stored
 * value, or any curve a project has already drawn. A lane keeps playing, keeps
 * saving, and becomes audible again the moment the user selects an algorithm
 * whose engine reads the parameter. The panel's algorithm chip dispatches
 * `algorithm` and nothing else, which
 * `proofChamberAlgorithmGating.spec.tsx` pins.
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
 *    from "broken". The disabled state plus the sentence below carries that
 *    information; a live knob carries none.
 *
 * The chosen shape is the one Nielsen's review of inactive controls recommends
 * (show disabled, keep the layout stable, and say why) and the one Eventide's
 * SP2016 ships for the same situation. It is a product call rather than a
 * technical one, and it is the part of this change most worth a second opinion.
 */
const AUTOMATION_CLAUSE = 'Automation already drawn for it is kept and plays again on an algorithm that reads it.';

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
        return `${controlLabel} does not apply to the ${algorithmLabel} algorithm. ${gap.note} ${AUTOMATION_CLAUSE}`;
    }
    return `${controlLabel} is not implemented on the ${algorithmLabel} algorithm yet, so this engine ignores it. ${AUTOMATION_CLAUSE}`;
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
