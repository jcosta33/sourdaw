import { type NativeDspDeviceType } from './nativeDspDeviceTypes';

/**
 * Advertised parameters a *non-default* engine of a native device drops on the
 * floor, and the wire dispatch that decides which engine is live.
 *
 * ## Why this is production code and not a test fixture
 *
 * This table started life inside `descriptorEngineParamWeld.spec.ts`, where it
 * exists to keep the census honest: every row is asserted in both directions,
 * so a gap that gets closed reds until the row is deleted, and a gap that
 * appears reds until a row is added. That property is the reason it is worth
 * anything, and it is the reason nothing else may keep a second copy.
 *
 * `ProofChamberPanel` needs the same fact — the Dutch Oven renders every
 * control on every algorithm, so on these rows the knob turns, the automation
 * lane records and persists, and the DSP never hears it. A hand-maintained
 * second list in the panel would drift the day a gap closed, and drift
 * silently, which is the exact defect class this census exists to catch. So the
 * table moves down here, into a cross-cutting module a production view and a
 * spec can both import, and the weld spec keeps asserting it.
 *
 * `src/utils/` rather than either module: `src/modules/ProofChamber` is not
 * importable from `src/modules/Arrangement`'s tests (models are private, and
 * the tests cruise forbids relative cross-module reach), and
 * `src/modules/Arrangement` is not importable from a ProofChamber view for the
 * same reason. `nativeDspDeviceTypes.ts` — which the weld spec already reads —
 * sits here for exactly this reason.
 *
 * ## Structural versus unbuilt
 *
 * Two different populations live in one table and must not be confused.
 *
 * - `unbuilt` — a defect awaiting DSP. The stage is simply not written, and
 *   writing it closes the row. The row is temporary; the day someone writes it,
 *   the weld spec reds until the row is deleted, and every consumer of this
 *   table re-enables the control with no further edit.
 * - `structural` — a category error *for the engine as it is built*. The
 *   parameter has nothing to act on here, so no amount of implementing the
 *   named feature closes the row: `width` has no side component to scale
 *   because the wet path is mono, and shimmer has no feedback loop to put a
 *   pitch shifter in. Established with cited research in #1506; each row
 *   carries its own reason.
 *
 * The distinction is *what would have to change*, not "never" versus "later".
 * A `structural` row can still be retired — but only by changing the engine's
 * topology, at which point the parameter becomes an ordinary unbuilt feature
 * or an ordinary working one. `width` on reverse is the live example: it is
 * structural today because the buffer is mono, and
 * `crates/proof-chamber/tests/output_stage_parameter_surface.rs` pins that
 * mono path precisely so the row turns into a defect the day the buffer goes
 * stereo. Reading `structural` as "nobody may ever revisit this" would make
 * that pin pointless; reading it as "this is not a missing stage" is what the
 * label is for.
 *
 * Research: `dutch-oven-per-algorithm-parameter-conventions.md`, workspace
 * artifacts. Both populations are inaudible to the user, so both are gated in
 * the panel; the difference survives in what the panel *says*.
 */
export type NativeDspEngineGapParam =
    | {
          readonly paramId: string;
          readonly kind: 'unbuilt';
      }
    | {
          readonly paramId: string;
          readonly kind: 'structural';
          /** Why no DSP will ever close this row. Shown to the user. */
          readonly note: string;
      };

export type NativeDspEngineGap = {
    readonly deviceId: NativeDspDeviceType;
    readonly engineId: string;
    readonly params: readonly NativeDspEngineGapParam[];
    readonly reason: string;
};

/**
 * Grouped by engine rather than one row per parameter because the reason is per
 * engine: it is one missing feature set, not forty-three unrelated omissions.
 */
export const NATIVE_DSP_ENGINE_GAPS: readonly NativeDspEngineGap[] = [
    {
        deviceId: 'dutch-oven',
        engineId: 'fdn',
        params: [
            { paramId: 'mod_rate', kind: 'unbuilt' },
            { paramId: 'diffusion', kind: 'unbuilt' },
            { paramId: 'freeze', kind: 'unbuilt' },
            { paramId: 'shimmer', kind: 'unbuilt' },
            { paramId: 'shimmer_amount', kind: 'unbuilt' },
            { paramId: 'shimmer_pitch', kind: 'unbuilt' },
            { paramId: 'gravity', kind: 'unbuilt' },
            { paramId: 'saturation_type', kind: 'unbuilt' },
            { paramId: 'density', kind: 'unbuilt' },
        ],
        reason:
            '`FdnReverb::set_param` (`fdn.rs`) answers to mix, rt60/decay, rt60_hf, damping, size, mod_depth, ' +
            'early_late, predelay, matrix and saturation, forwards high_cut/low_cut/width to the shared ' +
            '`OutputStage`, and drops the rest through `_ => {}`. The FDN has no shimmer pitch-shifter, no freeze ' +
            'latch, no gravity and no saturation curve selector — the stages simply are not built, so these are ' +
            'nine features to write rather than nine names to reconnect. `saturation` is accepted here, which is ' +
            'why only the *curve* selector is listed. Every row is `unbuilt`: an FDN is a recirculating network, ' +
            'so shimmer, freeze and diffusion all mean something here — the research finds them conventional on ' +
            'this topology, they are simply missing.',
    },
    {
        deviceId: 'dutch-oven',
        engineId: 'spring',
        params: [
            { paramId: 'predelay', kind: 'unbuilt' },
            { paramId: 'mod_rate', kind: 'unbuilt' },
            { paramId: 'freeze', kind: 'unbuilt' },
            { paramId: 'shimmer', kind: 'unbuilt' },
            { paramId: 'shimmer_amount', kind: 'unbuilt' },
            { paramId: 'shimmer_pitch', kind: 'unbuilt' },
            { paramId: 'gravity', kind: 'unbuilt' },
            { paramId: 'saturation', kind: 'unbuilt' },
            { paramId: 'saturation_type', kind: 'unbuilt' },
            {
                paramId: 'early_late',
                kind: 'structural',
                note: 'A spring tank has no distinct early-reflection stage to balance a tail against. Absent from all nine spring products surveyed in #1506.',
            },
            { paramId: 'density', kind: 'unbuilt' },
        ],
        reason:
            '`SpringReverb::set_param` (`spring.rs`) answers to mix, decay, feedback, damping, size, dispersion ' +
            'and mod_depth, and forwards high_cut/low_cut/width to the shared `OutputStage`. Its `param_names()` ' +
            'advertises exactly what it answers to, so the engine is honest with a host that asks; the descriptor ' +
            'is the layer that over-promises. `early_late` is the one structural row: an earlier revision of this ' +
            'table called it "the same reason it was on the plate before #1481", and #1506\'s survey does not ' +
            'support that reading — zero of nine spring products expose an early/late balance, and a tank has no ' +
            'early-reflection stage for one to act on.',
    },
    {
        deviceId: 'dutch-oven',
        engineId: 'reverse',
        params: [
            { paramId: 'damping', kind: 'unbuilt' },
            { paramId: 'predelay', kind: 'unbuilt' },
            { paramId: 'mod_rate', kind: 'unbuilt' },
            { paramId: 'mod_depth', kind: 'unbuilt' },
            { paramId: 'diffusion', kind: 'unbuilt' },
            {
                paramId: 'width',
                kind: 'structural',
                note: 'This engine writes one mono buffer and copies each sample to both channels, so a mid/side matrix has no side component to scale.',
            },
            { paramId: 'freeze', kind: 'unbuilt' },
            {
                paramId: 'shimmer',
                kind: 'structural',
                note: 'Shimmer is a feedback-stage effect — a pitch shifter inside the recirculating loop. The reverse engine has no feedback path.',
            },
            {
                paramId: 'shimmer_amount',
                kind: 'structural',
                note: 'Shimmer is a feedback-stage effect — a pitch shifter inside the recirculating loop. The reverse engine has no feedback path.',
            },
            {
                paramId: 'shimmer_pitch',
                kind: 'structural',
                note: 'Shimmer is a feedback-stage effect — a pitch shifter inside the recirculating loop. The reverse engine has no feedback path.',
            },
            { paramId: 'gravity', kind: 'unbuilt' },
            { paramId: 'saturation', kind: 'unbuilt' },
            { paramId: 'saturation_type', kind: 'unbuilt' },
            {
                paramId: 'early_late',
                kind: 'structural',
                note: 'A reverse build-up has no early-reflection stage. The balance reverse engines do expose is build-up against forward tail, which is a different control under a different name.',
            },
            { paramId: 'density', kind: 'unbuilt' },
        ],
        reason:
            '`ReverseReverb::set_param` (`reverse.rs`) answers to mix, decay, size, its own `reverse_time` and the ' +
            'shared `OutputStage`’s two tone filters, and nothing else. Fifteen of the twenty non-global ids the ' +
            'descriptor advertises are still inert on this algorithm — the widest gap of the four, and the one most ' +
            'likely to read as a broken device rather than a sparse one. Five of the fifteen are structural: ' +
            '`width` (the wet path is mono — `OutputStage::set_mono_param` refuses it, and ' +
            '`crates/proof-chamber/tests/output_stage_parameter_surface.rs` pins the mono wet path so the row ' +
            'becomes a defect the moment the reverse buffer goes stereo), the three `shimmer` ids (no feedback ' +
            'path to put a pitch shifter in), and `early_late` (no early-reflection stage; the balance the field ' +
            'exposes on a reverse engine is build-up-against-forward-tail, a different control needing a different ' +
            'label — a product decision, not a DSP one). The remaining ten are stages nobody has written.',
    },
];

/**
 * Which reverb engine each stored `algorithm` wire value constructs.
 *
 * The keys are a wire format: the number is written into project files and
 * replayed verbatim on load, and `ProofChamberInstance::set_param`
 * (`crates/proof-chamber/src/lib.rs:117-136`) is the only thing that decides
 * what each number means. 4 and 5 are reserved for the two convolution-backed
 * engines that fall through to the plate because nothing can supply an impulse
 * response; they are absent here because nothing should treat them as
 * selectable.
 *
 * Declared rather than derived because production runs in a browser and cannot
 * read `lib.rs`. `descriptorEngineParamWeld.spec.ts` can, and asserts this map
 * against the dispatch it scans out of the Rust — so the declaration cannot
 * drift from the engine it describes.
 */
export const DUTCH_OVEN_ENGINE_BY_WIRE_VALUE: Readonly<Record<number, string>> = {
    0: 'plate',
    1: 'fdn',
    2: 'fdn',
    3: 'spring',
    6: 'reverse',
};

export type FindNativeDspEngineGapParamInput = {
    readonly deviceId: NativeDspDeviceType;
    readonly engineId: string;
    readonly paramId: string;
};

/**
 * The gap row covering one `(device, engine, parameter)`, or `null` when the
 * engine answers to that parameter.
 *
 * The single accessor every consumer uses, so "is this control inert right
 * now?" has exactly one implementation reading exactly one table.
 */
export function findNativeDspEngineGapParam({
    deviceId,
    engineId,
    paramId,
}: FindNativeDspEngineGapParamInput): NativeDspEngineGapParam | null {
    for (const gap of NATIVE_DSP_ENGINE_GAPS) {
        if (gap.deviceId !== deviceId || gap.engineId !== engineId) {
            continue;
        }
        const match = gap.params.find((param) => param.paramId === paramId);
        if (match !== undefined) {
            return match;
        }
    }
    return null;
}
