import { getArticulationId, type LevainPatch } from '../models/LevainPatch';

type LevainEngineParameter = {
    name: string;
    value: number;
};

/** Project one Levain patch onto the complete engine state applied at registration. */
export function projectLevainPatchToEngineParameters(patch: LevainPatch): LevainEngineParameter[] {
    const parameters: LevainEngineParameter[] = [
        { name: 'master_gain', value: patch.masterGain },
        { name: 'current_articulation', value: getArticulationId(patch.currentArticulation) },
        { name: 'legato_enabled', value: patch.legato.enabled ? 1 : 0 },
        { name: 'legato_adaptive_speed', value: patch.legato.adaptiveSpeed ? 1 : 0 },
        { name: 'legato_slow_threshold_ms', value: patch.legato.slowThresholdMs },
        { name: 'legato_fast_threshold_ms', value: patch.legato.fastThresholdMs },
        {
            name: 'legato_portamento_velocity_threshold',
            value: patch.legato.portamentoVelocityThreshold,
        },
        { name: 'humanize_amount', value: patch.humanize.amount },
        { name: 'humanize_timing_max_ms', value: patch.humanize.timingMaxMs },
        { name: 'humanize_tuning_max_cents', value: patch.humanize.tuningMaxCents },
        { name: 'humanize_dynamic_max', value: patch.humanize.dynamicMax },
        { name: 'humanize_vibrato_var_max', value: patch.humanize.vibratoVarMax },
        {
            name: 'expression_dynamic_crossfade_time',
            value: patch.expression.dynamicCrossfadeTime,
        },
        { name: 'expression_vibrato_rate_min', value: patch.expression.vibratoRateMin },
        { name: 'expression_vibrato_rate_max', value: patch.expression.vibratoRateMax },
        { name: 'expression_vibrato_depth_max', value: patch.expression.vibratoDepthMax },
        { name: 'expression_vibrato_onset_delay', value: patch.expression.vibratoOnsetDelay },
    ];

    for (const [index, mic] of patch.micPositions.entries()) {
        parameters.push(
            { name: `mic_${index}_volume`, value: mic.volume },
            { name: `mic_${index}_pan`, value: mic.pan },
            { name: `mic_${index}_enabled`, value: mic.enabled ? 1 : 0 }
        );
    }

    return parameters;
}
