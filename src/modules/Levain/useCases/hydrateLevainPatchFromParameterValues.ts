import { type LevainPatch } from '../models/LevainPatch';

import { getLevainProjectParameterId } from './getLevainProjectParameterId';

type ReadParameterInput = {
    fallback: number;
    max: number;
    min: number;
    names: readonly string[];
    parameterValues: Readonly<Record<string, number>>;
};

function readParameter({ fallback, max, min, names, parameterValues }: ReadParameterInput): number {
    for (const name of names) {
        const value = parameterValues[name];
        if (value !== undefined && Number.isFinite(value)) {
            return Math.max(min, Math.min(max, value));
        }
    }
    return fallback;
}

type ReadEngineParameterInput = Omit<ReadParameterInput, 'names'> & {
    engineParameterName: string;
};

function readEngineParameter({
    engineParameterName,
    fallback,
    max,
    min,
    parameterValues,
}: ReadEngineParameterInput): number {
    // Canonical project ids win. The engine-form key remains a read-only fallback
    // for projects written before the bridge separated project identity from DSP
    // naming; the next explicit user edit writes only the canonical id.
    return readParameter({
        parameterValues,
        names: [getLevainProjectParameterId(engineParameterName), engineParameterName],
        fallback,
        min,
        max,
    });
}

type HydrateLevainPatchFromParameterValuesInput = {
    parameterValues: Readonly<Record<string, number>>;
    patch: LevainPatch;
};

/** Rebuild the session patch fields whose durable representation is numeric device state. */
export function hydrateLevainPatchFromParameterValues({
    parameterValues,
    patch,
}: HydrateLevainPatchFromParameterValuesInput): LevainPatch {
    const micPositions = patch.micPositions.map((mic, index) => ({
        ...mic,
        volume: readEngineParameter({
            parameterValues,
            engineParameterName: `mic_${index}_volume`,
            fallback: mic.volume,
            min: 0,
            max: 1,
        }),
        pan: readEngineParameter({
            parameterValues,
            engineParameterName: `mic_${index}_pan`,
            fallback: mic.pan,
            min: -1,
            max: 1,
        }),
        enabled:
            readEngineParameter({
                parameterValues,
                engineParameterName: `mic_${index}_enabled`,
                fallback: mic.enabled ? 1 : 0,
                min: 0,
                max: 1,
            }) > 0.5,
    }));
    const vibratoRateMin = readEngineParameter({
        parameterValues,
        engineParameterName: 'expression_vibrato_rate_min',
        fallback: patch.expression.vibratoRateMin,
        min: 2,
        max: 7,
    });
    const vibratoRateMax = readEngineParameter({
        parameterValues,
        engineParameterName: 'expression_vibrato_rate_max',
        fallback: patch.expression.vibratoRateMax,
        min: 2,
        max: 9,
    });

    return {
        ...patch,
        masterGain: readEngineParameter({
            parameterValues,
            engineParameterName: 'master_gain',
            fallback: patch.masterGain,
            min: 0,
            max: 2,
        }),
        legato: {
            ...patch.legato,
            enabled:
                readEngineParameter({
                    parameterValues,
                    engineParameterName: 'legato_enabled',
                    fallback: patch.legato.enabled ? 1 : 0,
                    min: 0,
                    max: 1,
                }) > 0.5,
            adaptiveSpeed:
                readEngineParameter({
                    parameterValues,
                    engineParameterName: 'legato_adaptive_speed',
                    fallback: patch.legato.adaptiveSpeed ? 1 : 0,
                    min: 0,
                    max: 1,
                }) > 0.5,
            slowThresholdMs: readEngineParameter({
                parameterValues,
                engineParameterName: 'legato_slow_threshold_ms',
                fallback: patch.legato.slowThresholdMs,
                min: 150,
                max: 500,
            }),
            fastThresholdMs: readEngineParameter({
                parameterValues,
                engineParameterName: 'legato_fast_threshold_ms',
                fallback: patch.legato.fastThresholdMs,
                min: 30,
                max: 200,
            }),
            portamentoVelocityThreshold: readEngineParameter({
                parameterValues,
                engineParameterName: 'legato_portamento_velocity_threshold',
                fallback: patch.legato.portamentoVelocityThreshold,
                min: 0,
                max: 127,
            }),
        },
        humanize: {
            ...patch.humanize,
            amount: readEngineParameter({
                parameterValues,
                engineParameterName: 'humanize_amount',
                fallback: patch.humanize.amount,
                min: 0,
                max: 1,
            }),
            timingMaxMs: readEngineParameter({
                parameterValues,
                engineParameterName: 'humanize_timing_max_ms',
                fallback: patch.humanize.timingMaxMs,
                min: 0,
                max: 25,
            }),
            tuningMaxCents: readEngineParameter({
                parameterValues,
                engineParameterName: 'humanize_tuning_max_cents',
                fallback: patch.humanize.tuningMaxCents,
                min: 0,
                max: 10,
            }),
            dynamicMax: readEngineParameter({
                parameterValues,
                engineParameterName: 'humanize_dynamic_max',
                fallback: patch.humanize.dynamicMax,
                min: 0,
                max: 0.15,
            }),
            vibratoVarMax: readEngineParameter({
                parameterValues,
                engineParameterName: 'humanize_vibrato_var_max',
                fallback: patch.humanize.vibratoVarMax,
                min: 0,
                max: 0.3,
            }),
        },
        expression: {
            ...patch.expression,
            dynamicCrossfadeTime: readEngineParameter({
                parameterValues,
                engineParameterName: 'expression_dynamic_crossfade_time',
                fallback: patch.expression.dynamicCrossfadeTime,
                min: 0.02,
                max: 0.3,
            }),
            vibratoRateMin: Math.min(vibratoRateMin, vibratoRateMax),
            vibratoRateMax: Math.max(vibratoRateMin, vibratoRateMax),
            vibratoDepthMax: readEngineParameter({
                parameterValues,
                engineParameterName: 'expression_vibrato_depth_max',
                fallback: patch.expression.vibratoDepthMax,
                min: 0,
                max: 50,
            }),
            vibratoOnsetDelay: readEngineParameter({
                parameterValues,
                engineParameterName: 'expression_vibrato_onset_delay',
                fallback: patch.expression.vibratoOnsetDelay,
                min: 0,
                max: 0.5,
            }),
        },
        micPositions,
    };
}
