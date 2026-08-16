/**
 * Grinder — amp simulator, cabinet, pedalboard, neural capture plugin descriptor.
 *
 * Parameter data is inlined here rather than imported from the Grinder
 * module. Models must not cross module boundaries; duplication is intentional.
 */

import { type PluginDescriptor, type PluginParamDef } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance } from './GuidanceProfiles';

const GRINDER_PARAMS: readonly PluginParamDef[] = [
    // Input
    { id: 'inputGain', label: 'Input', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5 },
    { id: 'inputImpedance', label: 'Impedance', min: 10, max: 10000, default: 1000, unit: 'kΩ', step: 10 },

    // Gate
    { id: 'gateThreshold', label: 'Gate', min: -80, max: 0, default: -60, unit: 'dB', step: 1 },
    // 2 ms / 120 ms, not the 0.5 / 50 this table shipped with. `7690f7139`
    // reworked `NoiseGate` so these times drive the gain stage as well as the
    // detector — before it the gate opened on a hard-coded `0.05` coefficient
    // and closed on `*= 0.999`, so the knobs only shaped the envelope follower
    // — and raised `DEFAULT_PATCH` to suit. This table was not updated.
    //
    // This descriptor is what a new instance sends to the engine: `addDevice`
    // writes every `param.value` through `updateDeviceParam`, while
    // `syncGrinderPatchToAudio` runs only on preset load and snapshot recall.
    // So the engine ran 0.5 / 50 while the panel read 2 / 120 — the descriptor
    // and the panel disagreed, and the descriptor is the one that was heard.
    // Aligned on the pair the panel and the patch already shared; this is a
    // consistency fix, not a voicing one, and nothing is audible today because
    // `gateEnabled` defaults false and is not advertised here at all. See
    // `declaredDefaultConsensus.spec.ts`.
    { id: 'gateAttack', label: 'Gate Atk', min: 0.1, max: 50, default: 2, unit: 'ms', scaling: 'log' },
    { id: 'gateRelease', label: 'Gate Rel', min: 5, max: 500, default: 120, unit: 'ms', scaling: 'log' },

    // Preamp
    { id: 'gain', label: 'Gain', min: 0, max: 10, default: 5, unit: '', step: 0.1 },
    { id: 'channel', label: 'Channel', min: 0, max: 2, default: 1, unit: '', step: 1 },
    { id: 'bright', label: 'Bright', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'fat', label: 'Fat', min: 0, max: 1, default: 0, unit: '', step: 1 },

    // Tone stack
    { id: 'bass', label: 'Bass', min: 0, max: 10, default: 5, unit: '', step: 0.1 },
    { id: 'mid', label: 'Mid', min: 0, max: 10, default: 5, unit: '', step: 0.1 },
    { id: 'treble', label: 'Treble', min: 0, max: 10, default: 5, unit: '', step: 0.1 },
    { id: 'presence', label: 'Presence', min: 0, max: 10, default: 5, unit: '', step: 0.1 },
    { id: 'resonance', label: 'Resonance', min: 0, max: 10, default: 5, unit: '', step: 0.1 },

    // Power amp
    { id: 'master', label: 'Master', min: 0, max: 10, default: 5, unit: '', step: 0.1 },
    { id: 'sagAmount', label: 'Sag', min: 0, max: 1, default: 0.4, unit: '', step: 0.01 },
    { id: 'sagRecovery', label: 'Sag Recovery', min: 10, max: 2000, default: 200, unit: 'ms', scaling: 'log' },
    { id: 'negFeedback', label: 'NFB', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Transformer
    { id: 'transformerDrive', label: 'Xfmr Drive', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
    { id: 'transformerHysteresis', label: 'Hysteresis', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
    { id: 'transformerLfSaturation', label: 'LF Sat', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },

    // Cabinet
    // No `step`. The builder below reuses `step` as a *type* oracle
    // (`step === 1 ? 'int' : 'float'`), and `int` is a write law, not a knob
    // increment — but `cabinet.rs` holds this as
    // `self.resonance_freq = value.clamp(40.0, 200.0)`. Of the ten log controls
    // that lost `step: 1`, this is the only one whose readout precision moves
    // with it (80 → 80.7), because
    // `deriveStep` lands on 0.8 for a 160 Hz span; that is the correct precision
    // for a control that steps in less than a hertz.
    { id: 'cabResonanceFreq', label: 'Cab Res', min: 40, max: 200, default: 80, unit: 'Hz', scaling: 'log' },
    { id: 'cabResonanceQ', label: 'Cab Q', min: 0.5, max: 10, default: 2, unit: '', step: 0.1 },
    { id: 'cabDamping', label: 'Damping', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'coneBreakup', label: 'Breakup', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
    { id: 'backEmf', label: 'Back EMF', min: 0, max: 1, default: 0.2, unit: '', step: 0.01 },
    { id: 'micBlend', label: 'Mic Blend', min: 0, max: 1, default: 0, unit: '', step: 0.01 },
    { id: 'roomAmount', label: 'Room', min: 0, max: 1, default: 0.1, unit: '', step: 0.01 },

    // Lab
    { id: 'tubeBias', label: 'Tube Bias', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'tubeAge', label: 'Tube Age', min: 0, max: 1, default: 0, unit: '', step: 0.01 },
    { id: 'millerCapacitance', label: 'Miller Cap', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'gridConduction', label: 'Grid Cond', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'couplingCapCharge', label: 'Coupling Cap', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'powerAmpBias', label: 'PA Bias', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Neural
    { id: 'engineMode', label: 'Engine Mode', min: 0, max: 2, default: 0, unit: '', step: 1 },
    { id: 'neuralMix', label: 'Neural Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01 },
    { id: 'neuralCpuBudget', label: 'CPU Budget', min: 0, max: 2, default: 1, unit: '', step: 1 },

    // Output
    { id: 'outputGain', label: 'Output', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5 },
    { id: 'outputMix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01 },
    { id: 'cleanBlend', label: 'Clean Blend', min: 0, max: 1, default: 0, unit: '', step: 0.01 },
    { id: 'limiterThreshold', label: 'Limiter', min: -12, max: 0, default: -0.3, unit: 'dB', step: 0.1 },
];

const GRINDER_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'grinder',
    name: 'Grinder',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: GRINDER_PARAMS.map((param) => ({
        id: param.id,
        deviceId: 'grinder',
        name: param.label,
        type: param.step === 1 ? 'int' : 'float',
        value: param.default,
        defaultValue: param.default,
        minValue: param.min,
        maxValue: param.max,
        unit: param.unit,
        scaling: param.scaling,
        automatable: true,
        hasAutomation: false,
    })),
};

export const GRINDER_DESCRIPTOR = applySingleDescriptorGuidance(
    GRINDER_DESCRIPTOR_DATA,
    descriptorGuidance(
        'grinder',
        effectGuidance(
            'Build an amp and cabinet signal path from input staging through gain, tone, and output controls.',
            ['Set input and output gain conservatively before increasing amp drive.'],
            ['Amp, cabinet, pedal, and capture choices interact with input impedance and output staging.'],
            ['High gain can amplify noise, create harshness, and overload later processing.'],
            {
                availability: 'unavailable',
                reason: 'Grinder declares no automatic loudness matching across amp and cabinet choices.',
            }
        ),
        declaredControl(
            'Amp and cabinet control',
            'Changes gain staging, tone, model choice, or signal-chain routing.',
            ['Set input stage before drive and output.'],
            ['High gain can amplify noise and overload later devices.']
        )
    )
);
