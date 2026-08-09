import { type GlutenPatch, type GlutenTopology } from './GlutenPatch';

/**
 * Display names for the topology selector, and for anything that has to name a
 * topology in prose.
 *
 * The panel's `TOPOLOGY_META` reads these rather than spelling them again, so
 * the chip a user clicks and the sentence a disabled control shows cannot end
 * up calling the same topology two different things.
 */
export const GLUTEN_TOPOLOGY_LABELS: Record<GlutenTopology, string> = {
    vca: 'VCA',
    opto: 'Opto',
    fet: 'FET',
    diode: 'Diode',
};

/**
 * Patch keys the panel renders in a card every topology sees — the Clamp,
 * Finish and Detector cards, the topology grid, the Quick-moves chips and the
 * Stage-two chips.
 *
 * Deliberately includes the device-level names (`mix`, `makeup`, `detection`,
 * the sidechain set, …). `GlutenEngine::set_param` answers those itself and
 * they are live on every topology; `glutenTopologyGating.spec.ts` reads the
 * engine's own arms out of `engine.rs` and subtracts them, so this list is "what
 * the panel offers unconditionally" and nothing here has to stay in step with
 * which layer happens to handle a name today.
 */
export const GLUTEN_SHARED_CONTROLS: readonly (keyof GlutenPatch)[] = [
    'topology',
    'style',
    'amount',
    'threshold',
    'ratio',
    'knee',
    'attack',
    'release',
    'makeup',
    'mix',
    'range',
    'stereoLink',
    'lookahead',
    'blendAmount',
    'blendTopology',
    'autoRelease',
    'autoMakeup',
    'deltaListen',
    'gainMatchBypass',
    'scHpfFreq',
    'scLpfFreq',
    'scEqFreq',
    'scEqGain',
    'scEqQ',
    'scHpfEnabled',
    'scLpfEnabled',
    'scEqEnabled',
    'extSidechain',
    'detection',
    'stereoMode',
    'thrust',
    'oversampling',
];

/**
 * Patch keys the Character card already renders only while its own topology is
 * selected. These need no gate — the conditional that draws them *is* the gate,
 * and it predates this file.
 */
export const GLUTEN_TOPOLOGY_OWNED_CONTROLS: Record<GlutenTopology, readonly (keyof GlutenPatch)[]> = {
    vca: ['vcaCharacter', 'vcaType', 'feedForward'],
    opto: ['limitMode'],
    fet: ['inputGain', 'outputGain', 'xfmrDrive', 'jfetK3', 'xfmrK2', 'allButtons'],
    diode: ['recovery'],
};

/**
 * Names the worklet can send that no control on the panel produces.
 *
 * The mirror image of this file's subject: a gap where the DSP is built and the
 * UI is missing, rather than the other way round. `peak_reduction` is the
 * LA-2A's single Peak Reduction control, which the opto struct implements as a
 * threshold remap; `limiter_threshold` is the 33609's limiter section, which the
 * diode bridge runs on every sample at a fixed −3 dB. `bypass` is the host's,
 * not the panel's.
 *
 * Listed rather than ignored so `glutenTopologyGating.spec.ts` can account for
 * every name in the worklet's map and a *new* orphan cannot hide among them.
 */
export const GLUTEN_UNRENDERED_PARAMS: readonly string[] = ['peakReduction', 'limiterThreshold', 'bypass'];

/**
 * A parameter one topology's `set_param` has no arm for.
 *
 * `structural` means the topology is modelled on hardware that has no such
 * control and there is nothing in the stage for the name to act on;
 * `unbuilt` means the value is a literal at the call site or the stage is
 * simply missing, so writing it closes the row and the control comes back with
 * no edit here.
 *
 * The distinction is *what would have to change*, not "never" versus "later" —
 * the same reading `#/utils/nativeDspEngineGaps` sets out for the Dutch Oven's
 * census. Every `structural` row carries the reason shown to the user, and
 * `glutenTopologyGating.spec.ts` reds on a structural row that does not.
 */
export type GlutenTopologyGapParam =
    | { readonly paramKey: keyof GlutenPatch; readonly kind: 'unbuilt' }
    | { readonly paramKey: keyof GlutenPatch; readonly kind: 'structural'; readonly note: string };

export type GlutenTopologyGap = {
    readonly topology: GlutenTopology;
    readonly params: readonly GlutenTopologyGapParam[];
    readonly reason: string;
};

/**
 * Every shared control each topology's struct drops on the floor.
 *
 * ## Why the panel needed a census at all
 *
 * `GlutenEngine::set_param` handles the device-level names itself and forwards
 * **everything else to all four topology structs at once** (`engine.rs`, the
 * `_ =>` arm), and each struct drops what it has no arm for through its own
 * `_ => {}`. So a name reaching the engine says nothing about whether the
 * topology the user is listening to did anything with it. The panel had four
 * topology conditionals, all of them in the Character card, and every other
 * control rendered live on all four topologies — including a 25–5000 ms
 * Release knob on Diode, whose release coefficient is recomputed from the
 * Recovery position on every change, printed directly above a caption saying
 * the release times are fixed.
 *
 * `crates/daw-dsp/tests/gluten_topology_param_reach.rs` measures every row:
 * two renders of the real crate differing in one parameter, compared sample
 * for sample. Each row below rendered bit-identically, and each is paired there
 * with a topology where the same parameter does move the output, so a stimulus
 * too weak to show anything cannot pass as proof of inertness.
 *
 * ## The treatment, and why it is not hiding
 *
 * Disable in place, keep the layout stable, and say why on the control itself
 * — settled for this codebase by the Dutch Oven's gating in #1519 rather than
 * re-derived here. Its research (Nielsen on inactive controls, Eventide's
 * SP2016 greying stages its vintage plate never had, Ableton's Hybrid Reverb,
 * Logic's Space Designer) applies unchanged: a live knob that does nothing is
 * indistinguishable from a broken one, and a control that vanishes takes the
 * layout with it. The one departure from that PR is scope — this device's
 * inert set depends on more than the selector, which the gate below handles
 * rather than the table.
 *
 * ## What gating does not touch
 *
 * The descriptor's `automatable` flag, the automation lane picker, stored
 * `parameterValues`, and any curve a project has already drawn. Gating refuses
 * manual entry and nothing else. Following #1519, a disabled control says what
 * its state is and why, and says nothing about what happens later.
 */
export const GLUTEN_TOPOLOGY_GAPS: readonly GlutenTopologyGap[] = [
    {
        topology: 'vca',
        params: [{ paramKey: 'oversampling', kind: 'unbuilt' }],
        reason:
            '`VcaCompressor::set_param` (`vca.rs`) answers to threshold, ratio, attack, release, knee, range, ' +
            'auto_release, vca_character, vca_type and feed_forward — every shared timing and curve control the ' +
            'panel offers. Only `oversampling` is missing, and it is a stage to write rather than a category ' +
            'error: the VCA runs its own k2 waveshaper (`vca_distortion`), so there is aliasing for a higher ' +
            'internal rate to move, and `ConfigurableOversample` already sits in the same module serving the FET ' +
            'and the diode bridge. VCA is the default topology, so this is the one row a user meets without ' +
            'touching anything.',
    },
    {
        topology: 'opto',
        params: [
            {
                paramKey: 'ratio',
                kind: 'structural',
                note: 'The modelled T4 cell sets its own ratio from how far the signal is over the threshold — about 3:1 rising toward 6:1, or a flat 10:1 in Limit. Compress / Limit in the Character section is the only ratio choice this topology has, the same way an LA-2A has no ratio control.',
            },
            {
                paramKey: 'attack',
                kind: 'structural',
                note: "The attack is the electroluminescent panel's rise time, fixed at about 10 ms. An opto compressor exposes no attack control because there is no component whose speed a knob could set.",
            },
            {
                paramKey: 'release',
                kind: 'structural',
                note: "Release here is the CdS cell's own charge memory — roughly 60 ms, stretching toward 5 s the longer the cell has been working. Programme material sets it, not a knob.",
            },
            {
                paramKey: 'autoRelease',
                kind: 'structural',
                note: "This cell's release is already programme-dependent, so there is no fixed release time for an auto mode to take over.",
            },
            {
                paramKey: 'knee',
                kind: 'structural',
                note: 'This topology has no static gain computer to put a knee on. Its curve comes from the ratio rising with excess, which is a soft knee that never stops widening.',
            },
            { paramKey: 'range', kind: 'unbuilt' },
            {
                paramKey: 'oversampling',
                kind: 'structural',
                note: 'The opto path applies its gain reduction as a plain multiply, with no waveshaper anywhere in it, so there is no aliasing for a higher internal rate to move.',
            },
        ],
        reason:
            '`OptoCompressor::set_param` (`opto.rs`) answers to threshold, limit_mode and peak_reduction, and to ' +
            'nothing else — seven of the shared controls the panel offers are inert here, the widest gap of the ' +
            'four and the one most likely to read as a broken device rather than a sparse one. Five are ' +
            'structural, and they are the same five an LA-2A leaves off its front panel: an opto compressor is ' +
            'defined by a cell that chooses its own ratio and its own timing. `range` is the exception — a ' +
            'max-reduction clamp is `apply_range`, which the VCA, FET and diode paths all call and this one does ' +
            'not, so it is one line rather than a category error.',
    },
    {
        topology: 'fet',
        params: [
            { paramKey: 'knee', kind: 'unbuilt' },
            { paramKey: 'range', kind: 'unbuilt' },
            { paramKey: 'autoRelease', kind: 'unbuilt' },
        ],
        reason:
            '`FetCompressor::set_param` (`fet.rs`) answers to threshold, ratio, attack, release, the five ' +
            'character controls and oversampling. All three gaps are `unbuilt`: `knee` and `range` are *literals* ' +
            'at the call site — `gain_computer(input_db, threshold, effective_ratio, 3.0)` and ' +
            '`apply_range(gc, 60.0)` — so each is one field away from working, and `auto_release` has a real ' +
            'release time here for an auto mode to steer and simply has no such mode written.',
    },
    {
        topology: 'diode',
        params: [
            {
                paramKey: 'release',
                kind: 'structural',
                note: 'Recovery is this topology’s release control. `update_coeffs` recomputes the release coefficient from the Recovery position on every change and overwrites whatever Release last stored, so the five fixed times — 50, 100, 400, 800 and 1500 ms — are the whole range available. That is the 33609’s own five-position recovery switch.',
            },
            {
                paramKey: 'autoRelease',
                kind: 'structural',
                note: 'Release is fixed by the Recovery position here, so there is no free release time for an auto mode to steer.',
            },
            { paramKey: 'knee', kind: 'unbuilt' },
            { paramKey: 'range', kind: 'unbuilt' },
        ],
        reason:
            '`DiodeCompressor::set_param` (`diode.rs`) answers to threshold, ratio, attack, recovery, ' +
            'limiter_threshold and oversampling. `release` and `auto_release` are the pair this device was ' +
            'reported for and both are structural — Recovery owns the release time. `knee` and `range` are the ' +
            'same literals-at-the-call-site shape as the FET, at 4.0 and 40.0.',
    },
];

export type GlutenControlGate = {
    readonly isInert: boolean;
    /** `null` exactly when `isInert` is false. */
    readonly kind: 'structural' | 'unbuilt' | null;
    /** A full sentence naming the topology and the reason, or null when the control is live. */
    readonly explanation: string | null;
};

const LIVE: GlutenControlGate = { isInert: false, kind: null, explanation: null };

/**
 * The engine engages Stage two at `blend_amount > 0.001` (`engine.rs`,
 * `process_block`). Matched exactly rather than tested against zero, because a
 * knob left at 0.0005 engages nothing and a gate that thought otherwise would
 * leave a genuinely dead control interactive.
 */
const BLEND_ENGAGED_THRESHOLD = 0.001;

function findGap(topology: GlutenTopology, paramKey: keyof GlutenPatch): GlutenTopologyGapParam | null {
    const gap = GLUTEN_TOPOLOGY_GAPS.find((entry) => entry.topology === topology);
    if (gap === undefined) {
        return null;
    }
    return gap.params.find((param) => param.paramKey === paramKey) ?? null;
}

/**
 * The second topology processing audio for this patch, or `null` when there is
 * only one.
 *
 * Stage two is not decoration — `process_block` runs the blend topology on the
 * primary's output, so a control the primary cannot hear is live again the
 * moment a topology that *can* is put behind it.
 * `stage_two_makes_release_audible_on_diode` measures exactly that: Release on
 * Diode is bit-identical at 50 ms and 3000 ms with Stage 2 down, and moves the
 * output once Stage 2 is at 50% with the VCA behind it. Gating on
 * `patch.topology` alone — which is what the issue proposed — would grey out a
 * control the user can hear.
 */
function blendStage(patch: GlutenPatch): GlutenTopology | null {
    if (patch.blendAmount > BLEND_ENGAGED_THRESHOLD && patch.blendTopology !== patch.topology) {
        return patch.blendTopology;
    }
    return null;
}

/**
 * Whether something *other than a topology* reads this parameter on this patch.
 *
 * One case, and it is measured rather than assumed: `compute_auto_makeup`
 * (`engine.rs`) reads the engine's own `current_ratio`, which the `ratio` name
 * sets for any topology on its way past. So Ratio on Opto — whose cell derives
 * its own ratio and has no arm for the name — still changes the output level
 * while Auto gain is on, by 1.39 peak in
 * `auto_gain_makes_ratio_audible_on_opto`, against exactly 0 with Auto gain off.
 *
 * Whether that side channel is *desirable* is a separate question: it computes
 * makeup from a ratio the opto cell never uses, so the compensation is wrong
 * for this topology. That is a defect in the makeup stage, filed separately.
 * Until it is fixed, the control is audible, and a gate is not allowed to call
 * an audible control inert.
 */
function hasNonTopologyConsumer(patch: GlutenPatch, paramKey: keyof GlutenPatch): boolean {
    return paramKey === 'ratio' && patch.autoMakeup;
}

function explain({
    gap,
    controlLabel,
    primary,
    blend,
}: {
    gap: GlutenTopologyGapParam;
    controlLabel: string;
    primary: GlutenTopology;
    blend: GlutenTopology | null;
}): string {
    let where = `the ${GLUTEN_TOPOLOGY_LABELS[primary]} topology`;
    if (blend !== null) {
        where = `${where}, or to the ${GLUTEN_TOPOLOGY_LABELS[blend]} stage behind it`;
    }

    if (gap.kind === 'structural') {
        return `${controlLabel} does not apply to ${where}. ${gap.note}`;
    }
    return `${controlLabel} is not implemented on ${where} yet, so this engine ignores it.`;
}

export type GlutenControlGateInput = {
    readonly patch: GlutenPatch;
    readonly paramKey: keyof GlutenPatch;
    /** The control's visible label, so the explanation names what the user is pointing at. */
    readonly controlLabel: string;
};

/**
 * Resolve one panel control against the topology census.
 *
 * A control is inert only when **no live stage** answers to it and nothing
 * outside the topologies reads it either. Anything short of that leaves the
 * control alone: the cost of a wrongly-greyed control is a user who cannot
 * reach a parameter that works, which is worse than the defect being fixed.
 */
export function glutenControlGate({ patch, paramKey, controlLabel }: GlutenControlGateInput): GlutenControlGate {
    if (hasNonTopologyConsumer(patch, paramKey)) {
        return LIVE;
    }

    const primaryGap = findGap(patch.topology, paramKey);
    if (primaryGap === null) {
        return LIVE;
    }

    const blend = blendStage(patch);
    if (blend !== null && findGap(blend, paramKey) === null) {
        return LIVE;
    }

    return {
        isInert: true,
        kind: primaryGap.kind,
        explanation: explain({ gap: primaryGap, controlLabel, primary: patch.topology, blend }),
    };
}
