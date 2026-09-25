/**
 * Crust — limiter/saturator plugin descriptor.
 *
 * Parameter data is inlined here rather than imported from the Crust
 * module. Models must not cross module boundaries; duplication is intentional.
 */

import { type PluginDescriptor, type PluginParamDef } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, effectGuidance } from './GuidanceProfiles';

const CRUST_PARAMS: readonly PluginParamDef[] = [
    { id: 'gain', label: 'Gain', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'ceiling', label: 'Ceiling', min: -6, max: 0, default: -0.3, unit: 'dBTP', step: 0.1 },
    { id: 'lookahead', label: 'Lookahead', min: 0, max: 10, default: 2, unit: 'ms', step: 0.1 },
    { id: 'attack', label: 'Attack', min: 0, max: 100, default: 0, unit: 'ms', step: 0.1 },
    // The switch that decides whether `attack` above is the attack at all.
    // `CrustEngine::apply_envelope` takes the algorithm profile's time constant
    // while this is on and the declared control only while it is off, and it
    // defaults on — so `attack` was declared, automatable, and discarded by the
    // engine unless someone opened the Crust panel and turned this off there.
    // An auto switch over the manual time constants is the standard shape for
    // this control (Waves L2's ARC, Ableton's Compressor "Auto Release"), and
    // like both of those it is two-position and defaults to auto.
    { id: 'attackAuto', label: 'Attack Auto', min: 0, max: 1, default: 1, unit: '', step: 1 },
    { id: 'release', label: 'Release', min: 0, max: 1000, default: 0, unit: 'ms', step: 1 },
    // Same switch for the release, with one extra engine behaviour behind it:
    // `apply_envelope` also forces the auto branch when `release` is 0, which
    // is that control's own default. So the release is program-dependent until
    // *both* this is off and `release` is above zero.
    { id: 'releaseAuto', label: 'Release Auto', min: 0, max: 1, default: 1, unit: '', step: 1 },
    { id: 'channelLinkTransient', label: 'Link Trans', min: 0, max: 100, default: 100, unit: '%', step: 1 },
    { id: 'channelLinkRelease', label: 'Link Rel', min: 0, max: 100, default: 100, unit: '%', step: 1 },
    { id: 'truePeak', label: 'True Peak', min: 0, max: 1, default: 1, unit: '', step: 1 },
    // The cascade in `crates/daw-dsp/src/crust/oversample.rs` builds powers of
    // two and `normalize_factor` floors anything else onto one, so the 26
    // integers this range used to offer alongside these six were positions the
    // engine could not tell apart. Measured, not argued:
    // `dawDspCrustOversampling.spec.ts` renders every integer in 1..32 through
    // the checked-in wasm and finds exactly these six distinct outputs.
    {
        id: 'oversampling',
        label: 'Oversampling',
        min: 1,
        max: 32,
        default: 4,
        unit: 'x',
        step: 1,
        legalSet: { values: [1, 2, 4, 8, 16, 32], resolution: 'floor' },
    },
    // The saturation stage's own enable, which `Saturator::is_idle` reads as
    // the first branch of the process path — a per-stage bypass of the kind
    // every module in a mastering suite carries (iZotope Ozone's per-module
    // power button). It defaults off, and `satDrive` and `satMix` below are
    // declared and automatable, so until this could be moved a lane drawn on
    // either of them rendered nothing.
    { id: 'satEnabled', label: 'Sat On', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'satDrive', label: 'Sat Drive', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'satMix', label: 'Sat Mix', min: 0, max: 100, default: 0, unit: '%', step: 1 },
    { id: 'deltaListen', label: 'Delta', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'scHpfFreq', label: 'SC HPF', min: 20, max: 200, default: 60, unit: 'Hz', step: 1 },
];

const CRUST_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'crust',
    name: 'Crust',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: CRUST_PARAMS.map((param) => ({
        id: param.id,
        deviceId: 'crust',
        name: param.label,
        type: param.step === 1 ? 'int' : 'float',
        value: param.default,
        defaultValue: param.default,
        minValue: param.min,
        maxValue: param.max,
        legalSet: param.legalSet,
        unit: param.unit,
        automatable: true,
        hasAutomation: false,
    })),
};

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const CRUST_DESCRIPTOR = applySingleDescriptorGuidance(
    CRUST_DESCRIPTOR_DATA,
    descriptorGuidance(
        'crust',
        effectGuidance(
            'Limit and saturate a signal while preserving a deliberate ceiling and downstream headroom.',
            ['Set ceiling before driving gain and compare loudness against bypass.'],
            ['Gain drives limiting and saturation while timing and oversampling shape artifacts.'],
            ['Aggressive drive can flatten transients and create misleading loudness.'],
            { availability: 'unavailable', reason: 'Crust declares no automatic loudness matching.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            gain: parameterGuidance(
                'Input drive gain',
                'Raises level into the limiter and saturator stages before ceiling and drive are applied.',
                0,
                6,
                [
                    "Drives both ceiling's limiter and satDrive's saturator stage harder as this rises: raise ceiling headroom or reduce satDrive to compensate.",
                ],
                [
                    'Raising gain without leaving ceiling headroom pushes reduction and saturation harder than the source calls for.',
                ],
                noExternalModulation
            ),
            ceiling: parameterGuidance(
                'Output true-peak ceiling',
                'Sets the hard maximum output level the limiter will not exceed.',
                -1,
                -0.1,
                [
                    'Set before raising gain, since a higher ceiling gives gain more headroom before limiting engages; truePeak decides whether this measures true peak or sample peak.',
                ],
                [
                    'A ceiling too close to 0 dBTP can still clip on inter-sample peaks downstream if truePeak is later disabled.',
                ],
                noExternalModulation
            ),
            lookahead: parameterGuidance(
                'Limiter look-ahead window',
                'Sets how far ahead the limiter reads the signal before the ceiling is enforced.',
                1,
                5,
                [
                    "A short lookahead silently truncates how long attack can ramp, and truePeak raises this window's effective floor for its own detector delay.",
                ],
                ['A lookahead shorter than the attack budget truncates the requested attack time without warning.'],
                noExternalModulation
            ),
            attack: parameterGuidance(
                'Manual limiter attack time',
                'Sets how quickly gain reduction catches a transient when attackAuto is off.',
                0,
                1.8,
                [
                    'attackAuto must be off for this value to reach the limiter, and the applied attack is capped at the set lookahead minus the true-peak detector delay (about 0.125 ms at 48 kHz while truePeak is on) — about 1.875 ms at the default 2 ms lookahead; raise lookahead to at least this value plus that delay for a longer attack to apply.',
                ],
                [
                    'This value is discarded by the engine whenever attackAuto is on, and even with that switch off, an attack above the lookahead-minus-detector-delay cap is silently shortened to it.',
                ],
                noExternalModulation
            ),
            attackAuto: parameterGuidance(
                'Attack automatic mode',
                "Chooses the algorithm's own profiled attack time instead of the manual attack control.",
                1,
                1,
                ['Turning this off is required before attack has any effect on the render.'],
                ['Leaving this on silently discards whatever value the attack control holds.'],
                noExternalModulation
            ),
            release: parameterGuidance(
                'Manual limiter release time',
                'Sets how quickly gain recovers after the limiter catches a peak, used only when the program-dependent branch is not forced.',
                50,
                400,
                [
                    "releaseAuto must be off and this must be above zero for the manual value to apply instead of the algorithm's program-dependent release.",
                ],
                [
                    'Leaving this at zero forces the program-dependent auto branch even when releaseAuto is off, so the manual value is silently ignored.',
                ],
                noExternalModulation
            ),
            releaseAuto: parameterGuidance(
                'Release automatic mode',
                "Chooses the algorithm's own program-dependent release instead of the manual release control.",
                1,
                1,
                ['Turning this off only hands control to release when release is also above zero.'],
                [
                    'Turning this off does not guarantee the manual release value takes effect, since a release of zero still forces the auto branch.',
                ],
                noExternalModulation
            ),
            channelLinkTransient: parameterGuidance(
                'Stereo link amount for transient catch',
                'Sets how far a channel that is deepening its own gain reduction follows the other, more-reduced channel while the limiter is catching a peak; a channel that is not itself reducing gain, such as the untouched side of a one-sided peak, ignores this control entirely.',
                90,
                100,
                [
                    'Works alongside channelLinkRelease, which instead governs a channel that is holding or recovering gain: on a one-sided peak the untouched channel follows the catching side through channelLinkRelease at the catch and through the recovery, not through this control.',
                ],
                [
                    'Reducing this below full link only lets a still-deepening channel lag behind a deeper-reducing other channel; it has no effect on a channel that is not itself reducing gain. Punchy, Dynamic, and Aggressive also scale this and channelLinkRelease below full (0.8, 0.9, and 0.6), so 100 is not full link under those algorithms.',
                ],
                noExternalModulation
            ),
            channelLinkRelease: parameterGuidance(
                'Stereo link amount for release recovery',
                "Sets how far a channel that is holding or recovering gain — including the untouched side of a one-sided peak — follows the other channel's deeper reduction, both at the moment the limiter catches and through the recovery that follows.",
                85,
                100,
                [
                    'Works alongside channelLinkTransient, which instead governs a channel that is itself deepening a reduction; a one-sided peak is carried entirely by this control, since the catching channel needs no linking and the untouched channel is always holding or recovering.',
                ],
                [
                    "Reducing this below full link lets the untouched or recovering channel pull away from the other channel's reduction, which can shift the stereo image during a catch or its decay. Punchy, Dynamic, and Aggressive also scale this and channelLinkTransient below full (0.8, 0.9, and 0.6), so 100 is not full link under those algorithms.",
                ],
                noExternalModulation
            ),
            truePeak: parameterGuidance(
                'True-peak detection mode',
                "Switches the limiter's peak detector between sample-peak and oversampled true-peak measurement.",
                1,
                1,
                ['Enabling this raises the floor lookahead can be reduced to before truncating detector delay.'],
                ['Disabling this can let inter-sample peaks pass the ceiling that true-peak mode would have caught.'],
                noExternalModulation
            ),
            oversampling: parameterGuidance(
                'Saturator oversampling factor',
                'Sets how many times the saturation stage upsamples before generating harmonics, trading CPU for reduced aliasing.',
                2,
                8,
                [
                    'Only applies while satEnabled is on and satMix is above zero, whatever satDrive is set to; the saturator stage stays idle and skips its oversampling step entirely when either is off, regardless of drive.',
                ],
                [
                    "Lowering this while the stage is engaged trades reduced CPU cost for more audible aliasing from the harmonic generator, since fewer oversampled points separate the shaping curve's harmonics from the Nyquist fold.",
                ],
                noExternalModulation
            ),
            satEnabled: parameterGuidance(
                'Saturation stage enable',
                'Switches the saturator stage in or out of the signal path.',
                0,
                0,
                ['satDrive and satMix are silent until this is on.'],
                [
                    'Leaving this off while raising satDrive or satMix produces no audible change, since the saturator stays idle until this switch is on.',
                ],
                noExternalModulation
            ),
            satDrive: parameterGuidance(
                'Saturation drive',
                "Sets how hard the signal is driven into the saturator's harmonic generator.",
                0,
                9,
                ['Has no audible effect unless satEnabled is on and satMix is above zero.'],
                [
                    'Driving this hard while oversampling is low can alias, since higher drive generates harmonics further above the oversampled band.',
                ],
                noExternalModulation
            ),
            satMix: parameterGuidance(
                'Saturation wet mix',
                'Blends the driven saturator signal back against the dry path.',
                0,
                40,
                ['Silent at zero regardless of satDrive, and produces nothing at all unless satEnabled is on.'],
                ['Raising this without satEnabled on has no audible result, since the saturator stage stays idle.'],
                noExternalModulation
            ),
            deltaListen: parameterGuidance(
                'Delta (difference) listen',
                'Solos what the limiter and saturator removed or added, instead of the processed programme.',
                0,
                0,
                [
                    'Reflects whatever gain and ceiling settings are currently doing to the signal; turn this back off before judging the processed mix.',
                ],
                [
                    'Leaving this on during export or mixdown would render the difference signal instead of the intended processed audio.',
                ],
                noExternalModulation
            ),
            scHpfFreq: parameterGuidance(
                'Sidechain detector highpass frequency',
                "Sets the corner of a highpass filter applied only to the limiter's gain-detector input, not the audible output.",
                40,
                120,
                [
                    "Crust's declared parameters expose no enable switch for the sidechain highpass itself, so this value currently reaches a detector stage that defaults off; gain and ceiling reduction are unaffected until that switch is enabled.",
                ],
                [
                    "While scHpfEnabled stays off, Crust's default, changing this value has no audible effect on gain reduction because the detector stage it feeds is bypassed; once a user turns that switch on from the Crust panel, this value reshapes how the limiter reacts to low frequencies.",
                ],
                noExternalModulation
            ),
        }
    )
);
