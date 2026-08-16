/**
 * Gluten — multi-topology bus compressor plugin descriptor.
 * Registers Gluten as an effect that can be added to any track.
 *
 * Parameter data is inlined here rather than imported from the Gluten
 * module. Models must not cross module boundaries; duplication is intentional.
 */

import { type PluginDescriptor, type PluginParamDef } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance } from './GuidanceProfiles';

const GLUTEN_PARAMS: readonly PluginParamDef[] = [
    // Core
    { id: 'topology', label: 'Topology', min: 0, max: 3, default: 0, unit: '', step: 1 },
    // style enum: glue=0, punch=1, smooth=2, pump=3 (Gluten STYLE_INDEX). The
    // engine consumes `style` and the bridge pushes it; without this entry the
    // generic param/automation system that reads this descriptor cannot see it.
    { id: 'style', label: 'Style', min: 0, max: 3, default: 0, unit: '', step: 1 },
    { id: 'amount', label: 'Amount', min: 0, max: 100, default: 50, unit: '%', step: 1 },
    { id: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB', step: 0.5 },
    { id: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, unit: ':1', step: 0.5 },
    { id: 'attack', label: 'Attack', min: 0.02, max: 250, default: 10, unit: 'ms', step: 0.1, scaling: 'log' },
    // No `step`. The builder below reuses `step` as a *type* oracle
    // (`step === 1 ? 'int' : 'float'`), and `int` declares that the only legal
    // values are the integers in the range — but `fet.rs`/`vca.rs` hold this as
    // `self.release_ms = value.clamp(25.0, 5000.0)`, and a 1 ms grid at the
    // 25 ms end of a log control is 4% of the setting. The knob's own step comes
    // from `deriveStep` and is overridden for log controls regardless.
    { id: 'release', label: 'Release', min: 25, max: 5000, default: 300, unit: 'ms', scaling: 'log' },
    { id: 'knee', label: 'Knee', min: 0, max: 30, default: 6, unit: 'dB', step: 0.5 },
    { id: 'makeup', label: 'Makeup', min: -12, max: 24, default: 0, unit: 'dB', step: 0.5 },
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01 },
    { id: 'autoMakeup', label: 'Auto Makeup', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'autoRelease', label: 'Auto Release', min: 0, max: 1, default: 1, unit: '', step: 1 },
    // Advanced
    { id: 'range', label: 'Range', min: 0, max: 60, default: 15, unit: 'dB', step: 1 },
    { id: 'lookahead', label: 'Lookahead', min: 0, max: 20, default: 0, unit: 'ms', step: 0.5 },
    { id: 'deltaListen', label: 'Delta Listen', min: 0, max: 1, default: 0, unit: '', step: 1 },
    // Sidechain
    // No `step`, same reason — and note `scLpfFreq` and `scEqFreq` two lines
    // below already carry non-unit steps and are `float` today; this makes the
    // three sidechain filter corners agree instead of one of them being `int`.
    { id: 'scHpfFreq', label: 'SC HPF', min: 20, max: 500, default: 80, unit: 'Hz', scaling: 'log' },
    { id: 'scHpfEnabled', label: 'SC HPF On', min: 0, max: 1, default: 1, unit: '', step: 1 },
    { id: 'thrust', label: 'Thrust', min: 0, max: 2, default: 0, unit: '', step: 1 },
    { id: 'detection', label: 'Detection', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'scLpfFreq', label: 'SC LPF', min: 1000, max: 20000, default: 20000, unit: 'Hz', step: 100, scaling: 'log' },
    { id: 'scLpfEnabled', label: 'SC LPF On', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'scEqFreq', label: 'SC EQ', min: 20, max: 20000, default: 1000, unit: 'Hz', step: 10, scaling: 'log' },
    { id: 'scEqGain', label: 'EQ Gain', min: -18, max: 18, default: 0, unit: 'dB', step: 0.5 },
    { id: 'scEqQ', label: 'EQ Q', min: 0.1, max: 10, default: 1, unit: '', step: 0.1 },
    { id: 'scEqEnabled', label: 'SC EQ On', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'extSidechain', label: 'Ext SC', min: 0, max: 1, default: 0, unit: '', step: 1 },
    // Quality
    // `ConfigurableOversample` in `crates/daw-dsp/src/gluten/oversample.rs`
    // implements 1x, 2x and 4x, so 3 is a position with no stage behind it.
    // Gluten's own panel and `clampOversampling` have offered and stored only
    // {1,2,4} for as long as they have existed; this is the same set said where
    // the generic Inspector, automation and the model action bridge can read
    // it, which is where 3 was still reachable.
    {
        id: 'oversampling',
        label: 'OS',
        min: 1,
        max: 4,
        // 1× by default: a fresh Gluten is a VCA, whose stage is not
        // oversampled. Moves with `DEFAULT_PATCH.oversampling`, which carries
        // the reasoning.
        default: 1,
        unit: '',
        step: 1,
        legalSet: { values: [1, 2, 4], resolution: 'floor' },
    },
    // Stereo
    { id: 'stereoLink', label: 'Stereo Link', min: 0, max: 1, default: 1, unit: '', step: 0.01 },
    { id: 'stereoMode', label: 'Stereo Mode', min: 0, max: 3, default: 0, unit: '', step: 1 },
    // FET-specific
    { id: 'inputGain', label: 'Input Gain', min: -12, max: 24, default: 0, unit: 'dB', step: 0.5 },
    { id: 'outputGain', label: 'Output Gain', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5 },
    { id: 'xfmrDrive', label: 'Transformer', min: 0, max: 3, default: 1.2, unit: '', step: 0.01 },
    { id: 'jfetK3', label: 'Odd', min: 0, max: 0.5, default: 0.15, unit: '', step: 0.01 },
    { id: 'xfmrK2', label: 'Even', min: 0, max: 0.3, default: 0, unit: '', step: 0.01 },
    { id: 'allButtons', label: 'All Buttons', min: 0, max: 1, default: 0, unit: '', step: 1 },
    // Opto-specific
    { id: 'limitMode', label: 'Limit Mode', min: 0, max: 1, default: 0, unit: '', step: 1 },
    // Diode-specific
    { id: 'recovery', label: 'Recovery', min: 1, max: 5, default: 3, unit: '', step: 1 },
    // VCA-specific
    { id: 'vcaCharacter', label: 'VCA Color', min: 0, max: 0.02, default: 0.003, unit: '', step: 0.001 },
    { id: 'vcaType', label: 'VCA Type', min: 0, max: 2, default: 1, unit: '', step: 1 },
    { id: 'feedForward', label: 'Feed-Forward', min: 0, max: 1, default: 0, unit: '', step: 1 },
    // Dual-stage blend
    { id: 'blendTopology', label: 'Blend Topo', min: 0, max: 3, default: 1, unit: '', step: 1 },
    { id: 'blendAmount', label: 'Blend', min: 0, max: 1, default: 0, unit: '', step: 0.01 },
    // Bypass
    { id: 'gainMatchBypass', label: 'Gain Match', min: 0, max: 1, default: 0, unit: '', step: 1 },
];

const GLUTEN_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'gluten',
    name: 'Gluten',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: GLUTEN_PARAMS.map((param) => ({
        id: param.id,
        deviceId: 'gluten',
        name: param.label,
        type: param.step === 1 ? 'int' : 'float',
        value: param.default,
        defaultValue: param.default,
        minValue: param.min,
        maxValue: param.max,
        legalSet: param.legalSet,
        unit: param.unit,
        scaling: param.scaling,
        automatable: true,
        hasAutomation: false,
    })),
};

export const GLUTEN_DESCRIPTOR = applySingleDescriptorGuidance(
    GLUTEN_DESCRIPTOR_DATA,
    descriptorGuidance(
        'gluten',
        effectGuidance(
            'Use topology and timing to shape bus dynamics, then restore only the level needed for comparison.',
            ['Confirm sidechain availability before planning ducking and level-match makeup against bypass.'],
            ['Topology, style, threshold, ratio, timing, and mix determine the bus response together.'],
            ['Aggressive ratios and makeup can flatten transients or overload the next stage.'],
            {
                availability: 'provided',
                parameterId: 'makeup',
                detail: 'Gluten makeup gain restores deliberate level after compression.',
            }
        ),
        declaredControl(
            'Bus-compression control',
            'Changes topology, reduction depth, timing, or output level.',
            ['Set topology before threshold, ratio, and timing.'],
            ['Aggressive compression can remove punch or create pumping.']
        )
    )
);
