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

/** Selector order, and the order any prose here lists topologies in. */
export const GLUTEN_TOPOLOGIES: readonly GlutenTopology[] = ['vca', 'opto', 'fet', 'diode'];

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

/** The topology struct has no match arm for the name, so `_ => {}` swallows it. */
export type GlutenGapLayer = 'set-param';

/**
 * A parameter one topology cannot hear.
 *
 * `structural` means the topology is modelled on hardware that has no such
 * control and there is nothing in the stage for the name to act on;
 * `unbuilt` means the value is a literal at the call site, or the stage — or
 * the routing that would carry it — is simply missing, so writing it closes the
 * row and the control comes back with no edit here.
 *
 * The distinction is *what would have to change*, not "never" versus "later" —
 * the same reading `#/utils/nativeDspEngineGaps` sets out for the Dutch Oven's
 * census. Every `structural` row carries the reason shown to the user, and
 * `glutenTopologyGating.spec.ts` reds on a structural row that does not.
 */
export type GlutenTopologyGapParam =
    | { readonly paramKey: keyof GlutenPatch; readonly kind: 'unbuilt'; readonly layer: GlutenGapLayer }
    | {
          readonly paramKey: keyof GlutenPatch;
          readonly kind: 'structural';
          readonly layer: GlutenGapLayer;
          readonly note: string;
      };

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
        params: [{ paramKey: 'oversampling', kind: 'unbuilt', layer: 'set-param' }],
        reason:
            '`VcaCompressor::set_param` (`vca.rs`) answers to threshold, ratio, attack, release, knee, range, ' +
            'auto_release, vca_character, vca_type and feed_forward — every shared timing and curve control the ' +
            'panel offers. Only `oversampling` is missing, and it is a stage to write rather than a category ' +
            'error: the VCA runs its own k2 waveshaper (`vca_distortion`), so there is aliasing for a higher ' +
            'internal rate to move, and `ConfigurableOversample` already sits in the same module serving the FET ' +
            'and the diode bridge. VCA is the default topology, so this is the one topology-specific gap a user ' +
            'meets without touching anything.',
    },
    {
        topology: 'opto',
        params: [
            {
                paramKey: 'ratio',
                kind: 'structural',
                layer: 'set-param',
                note: 'The modelled T4 cell sets its own ratio from how far the signal is over the threshold — about 3:1 rising toward 6:1, or a flat 10:1 in Limit. Compress / Limit in the Character section is the only ratio choice this topology has, the same way an LA-2A has no ratio control.',
            },
            {
                paramKey: 'attack',
                kind: 'structural',
                layer: 'set-param',
                note: "The attack is the electroluminescent panel's rise time, fixed at about 10 ms. An opto compressor exposes no attack control because there is no component whose speed a knob could set.",
            },
            {
                paramKey: 'release',
                kind: 'structural',
                layer: 'set-param',
                note: "Release here is the CdS cell's own charge memory — roughly 60 ms, stretching toward 5 s the longer the cell has been working. Programme material sets it, not a knob.",
            },
            {
                paramKey: 'autoRelease',
                kind: 'structural',
                layer: 'set-param',
                note: "This cell's release is already programme-dependent, so there is no fixed release time for an auto mode to take over.",
            },
            {
                paramKey: 'knee',
                kind: 'structural',
                layer: 'set-param',
                note: 'This topology has no static gain computer to put a knee on. Its curve comes from the ratio rising with excess, which is a soft knee that never stops widening.',
            },
            { paramKey: 'range', kind: 'unbuilt', layer: 'set-param' },
            {
                paramKey: 'oversampling',
                kind: 'structural',
                layer: 'set-param',
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
            { paramKey: 'knee', kind: 'unbuilt', layer: 'set-param' },
            { paramKey: 'range', kind: 'unbuilt', layer: 'set-param' },
            { paramKey: 'autoRelease', kind: 'unbuilt', layer: 'set-param' },
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
                layer: 'set-param',
                note: 'Recovery is this topology’s release control. `update_coeffs` recomputes the release coefficient from the Recovery position on every change and overwrites whatever Release last stored, so the five fixed times — 50, 100, 400, 800 and 1500 ms — are the whole range available. That is the 33609’s own five-position recovery switch.',
            },
            {
                paramKey: 'autoRelease',
                kind: 'structural',
                layer: 'set-param',
                note: 'Release is fixed by the Recovery position here, so there is no free release time for an auto mode to steer.',
            },
            { paramKey: 'knee', kind: 'unbuilt', layer: 'set-param' },
            { paramKey: 'range', kind: 'unbuilt', layer: 'set-param' },
        ],
        reason:
            '`DiodeCompressor::set_param` (`diode.rs`) answers to threshold, ratio, attack, recovery, ' +
            'limiter_threshold and oversampling. `release` and `auto_release` are the pair this device was ' +
            'reported for and both are structural — Recovery owns the release time. `knee` and `range` are the ' +
            'same literals-at-the-call-site shape as the FET, at 4.0 and 40.0.',
    },
];

/**
 * A control switched off by *another control's value* rather than by the
 * topology.
 *
 * A third population, and one the arm census is blind to for a different reason
 * than the routing rows: the name reaches its stage, the stage runs, and the
 * stage is a no-op because of what some other field is set to. Nothing about
 * the topology is involved, so these rows are not per-topology.
 *
 * ## Which no-ops get a gate, and which do not
 *
 * The rule this list follows: **gate a patch-state no-op when nothing else on
 * the panel already discloses it.** Applied to every case measured:
 *
 * - **Link under Dual mono** — gated. The overriding control is a stereo-mode
 *   chip in a different card, and the relationship (dual mono *is* an unlinked
 *   detector) is a convention rather than something the labels say.
 * - **Stage 2 with both stages on one topology** — gated, and the worst of the
 *   three: `blendTopology` defaults to Opto, so selecting Opto as the primary
 *   is enough to reach it, and the Stage-two chooser then shows three chips
 *   with none active above a knob that does nothing.
 * - **SC EQ frequency and EQ Q at 0 dB gain** — gated. There is no switch to
 *   read; the disclosure is a number on a third knob, which is exactly why the
 *   manual has to explain it in prose.
 * - **The SC EQ / HPF / LPF knobs while their own toggle is off** — *not*
 *   gated. The toggle sits beside them, is labelled, and already says it.
 *   Greying a filter's controls when its own enable switch is off adds nothing
 *   a user cannot see.
 * - **Match while the device is not bypassed** — *not* gated, and it is the
 *   one decision here rather than an application of the rule.
 *   `gain_match_bypass` is read inside `if self.bypassed` and renders `0e0` on
 *   all four topologies otherwise. Two reasons: the bypass state is not in
 *   `GlutenPatch` at all — it lives on the Arrangement `Device` — so gating on
 *   it would mean a panel reading foreign state to grey its own control; and
 *   Match would then be greyed in the device's *resting* state and live only
 *   while the user is already listening to bypassed audio, which reads as
 *   broken rather than as informative. The manual states the behaviour instead.
 */
export type GlutenPatchStateGap = {
    readonly paramKey: keyof GlutenPatch;
    /** Whether this patch is in the state that makes the control a no-op. */
    readonly appliesTo: (patch: GlutenPatch) => boolean;
    /** Why. Shown to the user, immediately before the remedy. */
    readonly note: (patch: GlutenPatch) => string;
    /** The move that brings the control back, as one imperative sentence. */
    readonly remedy: (patch: GlutenPatch) => string;
};

/**
 * The Character-card controls of a topology that is *named* by Stage two but is
 * not running, one row per control.
 *
 * Generated rather than typed out, from the same `GLUTEN_TOPOLOGY_OWNED_CONTROLS`
 * the card renders from, so a control added to a Character block is covered
 * without an edit.
 *
 * These exist because the Stage-two block is kept mounted whenever the two
 * topologies differ, rather than appearing and disappearing as `blendAmount`
 * crosses `0.001`. Mounting it on the threshold meant four controls and the
 * card's scroll height arriving under the user's thumb *mid-drag* of the very
 * knob that triggers it — a layout shift caused by a gesture in progress, which
 * is the thing disable-in-place exists to avoid, in its most acute form.
 */
function stageTwoCharacterGaps(): GlutenPatchStateGap[] {
    return GLUTEN_TOPOLOGIES.flatMap((owner) =>
        GLUTEN_TOPOLOGY_OWNED_CONTROLS[owner].map((paramKey) => ({
            paramKey,
            appliesTo: (patch: GlutenPatch) => patch.topology !== owner && glutenBlendStage(patch) === null,
            note: () =>
                `Stage two names ${GLUTEN_TOPOLOGY_LABELS[owner]} but is not running it — the second stage is ` +
                'switched off while Stage 2 sits at 0%.',
            remedy: () => 'Raise Stage 2 above 0% to use this.',
        }))
    );
}

export const GLUTEN_PATCH_STATE_GAPS: readonly GlutenPatchStateGap[] = [
    {
        paramKey: 'stereoLink',
        appliesTo: (patch) => patch.stereoMode === 'dual-mono',
        note: () =>
            'Dual mono is an unlinked detector by definition, so `apply_detector_settings` forces the link to 0 ' +
            'while it is selected.',
        remedy: () => 'Choose Stereo, Mid or Side to use Link.',
    },
    {
        paramKey: 'blendAmount',
        appliesTo: (patch) => patch.blendTopology === patch.topology,
        note: (patch) =>
            'Stage two only runs when its topology differs from the primary, and both are ' +
            `${GLUTEN_TOPOLOGY_LABELS[patch.topology]}.`,
        remedy: () => 'Pick a different topology in the Stage two section.',
    },
    {
        paramKey: 'scEqFreq',
        appliesTo: (patch) => patch.scEqGain === 0,
        note: () => 'The detector’s bell is flat until EQ Gain leaves 0 dB, so there is no bell for this to centre.',
        remedy: () => 'Set EQ Gain first.',
    },
    {
        paramKey: 'scEqQ',
        appliesTo: (patch) => patch.scEqGain === 0,
        note: () => 'The detector’s bell is flat until EQ Gain leaves 0 dB, so there is no bell for this to widen.',
        remedy: () => 'Set EQ Gain first.',
    },
    ...stageTwoCharacterGaps(),
];

/**
 * Why a control is refused, on the axis of *what would have to change*.
 *
 * `structural` — the engine's topology; `unbuilt` — DSP or routing somebody has
 * to write; `overridden` — another control on this same panel, which the user
 * can move right now. Only the third is something the user can act on, which is
 * why it is a separate kind rather than folded into the other two, and why its
 * sentence ends with the move that brings the control back.
 */
export type GlutenControlGateKind = 'structural' | 'unbuilt' | 'overridden';

export type GlutenControlGate = {
    readonly isInert: boolean;
    /** `null` exactly when `isInert` is false. */
    readonly kind: GlutenControlGateKind | null;
    /** A full sentence naming the reason and ending with the remedy, or null when the control is live. */
    readonly explanation: string | null;
    /**
     * The move that brings this control back, as one imperative sentence.
     *
     * The last clause of `explanation`, exposed separately so an owning card can
     * print it once for a whole group instead of hiding it in a `title` that no
     * keyboard or touch gesture triggers.
     *
     * `null` only when the control is live, or — defensively — when no live
     * configuration exists for it. Every censused parameter has at least one
     * topology that hears it today, so the second case is unreachable and is
     * handled rather than asserted.
     */
    readonly remedy: string | null;
};

const LIVE: GlutenControlGate = { isInert: false, kind: null, explanation: null, remedy: null };

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
export function glutenBlendStage(patch: GlutenPatch): GlutenTopology | null {
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

/**
 * The topologies that *do* answer to a parameter, in selector order.
 *
 * Derived by subtraction from the same census the gate reads, so it cannot
 * disagree with it: a topology hears a parameter exactly when it has no gap row
 * for it.
 */
function topologiesThatHear(paramKey: keyof GlutenPatch): GlutenTopology[] {
    return GLUTEN_TOPOLOGIES.filter((topology) => findGap(topology, paramKey) === null);
}

function joinWithOr(labels: readonly string[]): string {
    if (labels.length <= 1) {
        return labels[0] ?? '';
    }
    return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1) ?? ''}`;
}

/**
 * The move that brings a topology-gated control back.
 *
 * Every one of these rows has an escape and it is always the same shape —
 * select a topology that hears the parameter, or run one behind the primary in
 * Stage two, which `process_block` gives the same writes to. An earlier
 * revision put this clause only on the detector-routing rows, so twenty-one
 * explanations named the way out and twenty-four stopped at the diagnosis —
 * while `blendHearsIt` in this very file was already honouring the escape for
 * all of them, and `stage_two_makes_release_audible_on_diode` was already
 * measuring it.
 *
 * Which topologies help is *derived* rather than phrased generically, because
 * "run another topology in Stage two" is not true: Knee and Auto rel come back
 * only under the VCA, Release under the VCA or the FET, OS under the FET or the
 * diode. A remedy that sent a user to the wrong topology would be a new version
 * of the defect this PR exists to remove.
 */
function remedyFor(paramKey: keyof GlutenPatch): string | null {
    const helpers = topologiesThatHear(paramKey).map((topology) => GLUTEN_TOPOLOGY_LABELS[topology]);
    // Unreachable on today's census — every censused parameter is heard by at
    // least one topology — and deliberately handled rather than asserted,
    // because the alternative is a control whose explanation ends mid-sentence.
    // `glutenTopologyGating.spec.ts` proves the unreachability rather than
    // leaving it as a claim here, so a future row with no live topology reds in
    // the spec instead of silently dropping the clause.
    if (helpers.length === 0) {
        return null;
    }
    const list = joinWithOr(helpers);
    return `Select ${list}, or run ${helpers.length > 1 ? 'one of them' : list} in Stage two, to use this.`;
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

    const remedy = remedyFor(gap.paramKey);
    const tail = remedy === null ? '' : ` ${remedy}`;

    if (gap.kind === 'structural') {
        return `${controlLabel} does not apply to ${where}. ${gap.note}${tail}`;
    }
    return `${controlLabel} is not implemented on ${where} yet, so this engine ignores it.${tail}`;
}

export type GlutenControlGateInput = {
    readonly patch: GlutenPatch;
    readonly paramKey: keyof GlutenPatch;
    /** The control's visible label, so the explanation names what the user is pointing at. */
    readonly controlLabel: string;
};

/**
 * Resolve one panel control against the topology and patch-state censuses.
 *
 * A control is inert only when **no live stage** answers to it and nothing
 * outside the topologies reads it either. Anything short of that leaves the
 * control alone: the cost of a wrongly-greyed control is a user who cannot
 * reach a parameter that works, which is worse than the defect being fixed.
 *
 * Order matters where two reasons are true at once. The topology census is
 * asked first because it is the deeper fact; a patch-state remedy cannot make a
 * topology-owned parameter work on a topology that does not implement it.
 */
export function glutenControlGate({ patch, paramKey, controlLabel }: GlutenControlGateInput): GlutenControlGate {
    if (hasNonTopologyConsumer(patch, paramKey)) {
        return LIVE;
    }

    const blend = glutenBlendStage(patch);
    const primaryGap = findGap(patch.topology, paramKey);
    const blendHearsIt = blend !== null && findGap(blend, paramKey) === null;
    if (primaryGap !== null && !blendHearsIt) {
        return {
            isInert: true,
            kind: primaryGap.kind,
            explanation: explain({ gap: primaryGap, controlLabel, primary: patch.topology, blend }),
            remedy: remedyFor(paramKey),
        };
    }

    const patchStateGap = GLUTEN_PATCH_STATE_GAPS.find((gap) => gap.paramKey === paramKey && gap.appliesTo(patch));
    if (patchStateGap !== undefined) {
        const remedy = patchStateGap.remedy(patch);
        return {
            isInert: true,
            kind: 'overridden',
            explanation: `${controlLabel} does nothing on this patch. ${patchStateGap.note(patch)} ${remedy}`,
            remedy,
        };
    }

    return LIVE;
}

/**
 * One option of the Stage-two chooser.
 *
 * The chooser used to render only the three topologies that are *not* the
 * primary, which made two things unreadable at once: with Stage two still
 * naming the primary — reachable from the defaults by selecting Opto, since
 * `blendTopology` starts there — the chooser showed three chips with none of
 * them active, and the Stage 2 knob's own reason ("both are Opto") named a
 * state the user could not see anywhere on screen.
 *
 * All four render now, and the primary's own chip is refused with the reason,
 * so the greyed-and-active chip *is* the display of that state.
 */
export function glutenStageTwoOptionGate({
    patch,
    option,
}: {
    readonly patch: GlutenPatch;
    readonly option: GlutenTopology;
}): GlutenControlGate {
    if (option !== patch.topology) {
        return LIVE;
    }
    const label = GLUTEN_TOPOLOGY_LABELS[option];
    const remedy = 'Pick one of the other three, or change the primary topology.';
    return {
        isInert: true,
        kind: 'overridden',
        explanation:
            `${label} is already the primary topology, and Stage two runs a second, different compressor behind ` +
            `the first — \`process_block\` skips the blend entirely while the two match. ${remedy}`,
        remedy,
    };
}

export type GlutenCardNoticeInput = {
    readonly labels: readonly string[];
    readonly gates: readonly GlutenControlGate[];
};

/**
 * One visible line for a card, naming its inert controls and how to get them
 * back — or `null` when nothing in the card is refused.
 *
 * `title` is the wrong and only channel a disabled control had: it has no
 * keyboard trigger and no touch trigger, so a sighted keyboard user could not
 * read an explanation a screen-reader user hears in full. This puts the same
 * information on the page. `title` stays as the per-control detail, because a
 * card line cannot carry seventeen separate reasons.
 *
 * Remedies are deduplicated rather than repeated: a Detector card with twelve
 * inert controls has one remedy between them, and printing it twelve times
 * would bury the control names that make the line worth reading.
 */
export function glutenCardNotice({ labels, gates }: GlutenCardNoticeInput): string | null {
    const inert = gates
        .map((gate, index) => ({ gate, label: labels[index] ?? '' }))
        .filter((entry) => entry.gate.isInert);
    if (inert.length === 0) {
        return null;
    }

    const names = [...new Set(inert.map((entry) => entry.label))];
    const remedies = [...new Set(inert.map((entry) => entry.gate.remedy).filter((remedy) => remedy !== null))];
    const verb = names.length === 1 ? 'is' : 'are';
    return `${joinWithAnd(names)} ${verb} inert here. ${remedies.join(' ')}`.trim();
}

function joinWithAnd(labels: readonly string[]): string {
    if (labels.length <= 1) {
        return labels[0] ?? '';
    }
    return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}
