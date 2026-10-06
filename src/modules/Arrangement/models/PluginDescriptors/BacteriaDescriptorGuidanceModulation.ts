import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Bacteria's modulation sources, taken from
 * `crates/daw-dsp/src/bacteria/engine.rs` and `modulation.rs`.
 *
 * The sources run continuously, but the audio engine only reads them through
 * modulation assignments and macro mappings, and the targets those can name
 * are the global mix, a band gain, a band's distortion drive and a band's
 * filter cutoff. The assignments are not descriptor parameters, so each
 * control below changes nothing audible until a route exists in the Bacteria
 * panel. The LFOs, envelope follower and macros are source ids 0 and 1, 2 and
 * 6 to 13.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

function macroControl(index: number): DeviceParameterGuidance {
    return parameterGuidance(
        `Macro ${index} modulation position`,
        `Moves everything routed to macro ${index} together with one knob, from the bottom to the top of each mapped range.`,
        0.1,
        0.9,
        [
            `Macro ${index} is modulation source ${index + 5}; each mapping adds its minimum plus this position times its span to the global mix, a band gain, drive or filterCutoff, so mix, drive and filterCutoff are what it can move.`,
        ],
        [
            `Macro ${index} changes nothing until the Bacteria panel maps it to a target, and a mapping added to the same target as an LFO or another macro sums with it rather than replacing it.`,
        ],
        noExternalModulation
    );
}

function lfoRate(index: number, minimum: number, maximum: number): DeviceParameterGuidance {
    return parameterGuidance(
        `LFO ${index} cycle rate`,
        `Sets how fast LFO ${index} cycles, from slow drift to audible tremolo-rate movement.`,
        minimum,
        maximum,
        [
            `Sets the cycle length of LFO ${index} in hertz (modulation source ${index - 1}); lfo${index}Shape sets the waveform and lfo${index}Amount its depth.`,
        ],
        [
            `LFO ${index} changes nothing audible until a modulation assignment routes it to the global mix, a band gain, drive or filterCutoff, and above about 20 Hz a gain or cutoff route becomes audible as ring-modulation-like roughness.`,
        ],
        noExternalModulation
    );
}

function lfoShape(index: number, minimum: number, maximum: number): DeviceParameterGuidance {
    return parameterGuidance(
        `LFO ${index} waveform`,
        `Chooses the movement of LFO ${index}: sine (0), triangle (1), saw (2), square (3) or sample-and-hold (4).`,
        minimum,
        maximum,
        [
            `Shapes the output of LFO ${index} before lfo${index}Amount scales it, and lfo${index}Rate decides how often the shape repeats.`,
        ],
        [
            `Square and sample-and-hold LFO ${index} jump instantly between values, so a route to drive or filterCutoff steps abruptly and can click, and sample-and-hold takes its value from the phase remainder at each wrap rather than from a true random source.`,
        ],
        noExternalModulation
    );
}

function lfoAmount(index: number): DeviceParameterGuidance {
    return parameterGuidance(
        `LFO ${index} output depth`,
        `Scales how far LFO ${index} swings, from still to its full range of plus and minus one.`,
        0.2,
        0.8,
        [
            `Multiplies the output of LFO ${index} before each assignment amount is applied, so the depth heard is this value times that amount; lfo${index}Rate and lfo${index}Shape set the movement being scaled.`,
        ],
        [
            `At 0 LFO ${index} is silent whatever its assignments say, and at 1 it spans the full assigned range, so a drive or filterCutoff route can sweep much further than the knob suggests.`,
        ],
        noExternalModulation
    );
}

export const BACTERIA_MODULATION_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    macro1: macroControl(1),
    macro2: macroControl(2),
    macro3: macroControl(3),
    macro4: macroControl(4),
    macro5: macroControl(5),
    macro6: macroControl(6),
    macro7: macroControl(7),
    macro8: macroControl(8),
    lfo1Rate: lfoRate(1, 0.1, 8),
    lfo1Shape: lfoShape(1, 0, 2),
    lfo1Amount: lfoAmount(1),
    lfo2Rate: lfoRate(2, 0.05, 4),
    lfo2Shape: lfoShape(2, 0, 3),
    lfo2Amount: lfoAmount(2),
    envFollowerAttack: parameterGuidance(
        'Envelope follower attack time',
        'Sets how quickly the input-level modulation source rises on a transient.',
        1,
        20,
        [
            'Shapes modulation source 2, which follows the rectified average of the input after inputGain; envFollowerRelease sets how quickly it falls, and it only matters once an assignment routes it.',
        ],
        [
            'A very fast attack makes the follower track individual cycles of low notes, which can make a routed drive or filterCutoff modulate at audio rate and add roughness.',
        ],
        noExternalModulation
    ),
    envFollowerRelease: parameterGuidance(
        'Envelope follower release time',
        'Sets how long the input-level modulation source takes to fall after the signal drops, from snappy to a slow sustained follow.',
        50,
        500,
        [
            'Controls the decay of modulation source 2 after envFollowerAttack has raised it; inputGain changes the level it follows, and it only matters once an assignment routes it.',
        ],
        [
            'A long release keeps a routed target open long after the input stops, so a gain or cutoff route can seem to stick on between short notes.',
        ],
        noExternalModulation
    ),
};
