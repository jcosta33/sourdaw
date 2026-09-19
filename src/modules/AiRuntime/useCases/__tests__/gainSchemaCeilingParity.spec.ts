import { describe, expect, it } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { DAW_TOOL_SCHEMAS } from '../../models/ToolDefinitions';
import { PAYLOAD_VALIDATORS } from '../validateActionPayload';

/**
 * A tool description that names a ceiling is a contract with the model: it
 * will not ask for a value it has been told is out of range, so a stale
 * literal makes the acceptor's real range unreachable from the tool path
 * however wide that range is. Both LLM-facing surfaces are checked — the
 * system-prompt schemas in `DAW_TOOL_SCHEMAS` and the provider schemas the
 * executable registry emits — because either one alone can drift.
 *
 * The acceptor's ceiling is *measured* by bisection, not restated: this file
 * names no ceiling constant of its own, so it cannot agree with a wrong schema
 * by copying the same wrong number into the expectation.
 *
 * Each description is read in the unit it speaks, and the unit is decided by
 * the schema rather than by sniffing the prose: the `gain` property is a linear
 * amplitude, the `gainDb` property is decibels, and the tool's own description
 * speaks the schema's primary unit — decibels once it offers `gainDb`, linear
 * gain otherwise. A figure stated in some third unit — a percentage, a
 * millisecond — reads here as a level the acceptor is expected to honour, and
 * reds. Say it in the unit that property speaks, or say it without a number.
 */

type GainSchemaCase = {
    actionType: 'setTrackGain' | 'setMasterGain';
    /** A payload that differs from the advertised gain only in that field. */
    payloadFor: (gain: number) => unknown;
};

const gainSchemaCases: readonly GainSchemaCase[] = [
    { actionType: 'setTrackGain', payloadFor: (gain) => ({ trackId: 'track-1', gain }) },
    { actionType: 'setMasterGain', payloadFor: (gain) => ({ gain }) },
];

type ToolFunction = {
    description: string;
    parameters: { properties: Record<string, unknown> };
};

/** Every number a description states, signed, so a decibel floor reads as one figure. */
function figuresIn(text: string): number[] {
    return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function descriptionOf(toolFunction: ToolFunction, property: string): string | null {
    const candidate = toolFunction.parameters.properties[property];
    if (typeof candidate !== 'object' || candidate === null || !('description' in candidate)) {
        return null;
    }
    return String(candidate.description);
}

/**
 * The largest gain the acceptor honours. 60 halvings of `[0, 8]` resolve far
 * finer than the two decimals the comparison below asks for.
 */
function measureAcceptorCeiling(accepts: (gain: number) => boolean): number {
    expect(accepts(0)).toBe(true);
    expect(accepts(8)).toBe(false);
    let low = 0;
    let high = 8;
    for (let step = 0; step < 60; step += 1) {
        const middle = (low + high) / 2;
        if (accepts(middle)) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return low;
}

function acceptorFor({ actionType, payloadFor }: GainSchemaCase): (gain: number) => boolean {
    const guard = PAYLOAD_VALIDATORS[actionType];
    if (guard === 'unchecked') {
        throw new Error(`${actionType} has no payload validator`);
    }
    return (gain: number) => guard(payloadFor(gain));
}

/** Every advertised amplitude is honoured, and the top of the advertised range is the acceptor's own. */
function expectLinearRangeHonoured(text: string, label: string, accepts: (gain: number) => boolean): void {
    const advertised = figuresIn(text);
    expect(advertised.length, `${label} advertises no gain range: "${text}"`).toBeGreaterThan(0);

    for (const gain of advertised) {
        expect(accepts(gain), `${label} advertises ${String(gain)}, which the acceptor rejects`).toBe(true);
    }
    expect(Math.max(...advertised), `${label} does not advertise the acceptor's ceiling`).toBeCloseTo(
        measureAcceptorCeiling(accepts),
        2
    );
}

/**
 * Every advertised decibel figure is honoured once converted, and the advertised
 * ceiling is the acceptor's own: one decibel above it must be refused, or the
 * description is quoting a bound the acceptor does not hold.
 */
function expectDecibelRangeHonoured(text: string, label: string, accepts: (gain: number) => boolean): void {
    const advertised = figuresIn(text);
    expect(advertised.length, `${label} advertises no decibel range: "${text}"`).toBeGreaterThan(0);

    for (const db of advertised) {
        expect(accepts(dbToGain(db)), `${label} advertises ${String(db)} dB, which the acceptor rejects`).toBe(true);
    }
    const advertisedCeilingDb = Math.max(...advertised);
    expect(
        accepts(dbToGain(advertisedCeilingDb + 1)),
        `${label} advertises ${String(advertisedCeilingDb)} dB as its ceiling, but the acceptor honours more`
    ).toBe(false);
}

/** The unit the tool's own description speaks: decibels once the schema offers a `gainDb` field. */
function expectToolDescriptionHonoured(toolFunction: ToolFunction, label: string, accepts: (gain: number) => boolean) {
    if (descriptionOf(toolFunction, 'gainDb') === null) {
        expectLinearRangeHonoured(toolFunction.description, `${label} description`, accepts);
        return;
    }
    expectDecibelRangeHonoured(toolFunction.description, `${label} description`, accepts);
}

function expectLinearGainFieldHonoured(toolFunction: ToolFunction, label: string, accepts: (gain: number) => boolean) {
    const gainDescription = descriptionOf(toolFunction, 'gain');
    if (gainDescription === null) {
        throw new Error(`${label} states no range for its linear gain field`);
    }
    expectLinearRangeHonoured(gainDescription, `${label} gain`, accepts);
}

function systemPromptSchema(actionType: string): ToolFunction {
    const schema = DAW_TOOL_SCHEMAS.find((candidate) => candidate.function.name === actionType);
    if (!schema) {
        throw new Error(`no system-prompt tool schema for ${actionType}`);
    }
    return schema.function;
}

function registrySchema(actionType: string): ToolFunction {
    const schema = getExecutableAppActionToolSchemas().find((candidate) => candidate.function.name === actionType);
    if (!schema) {
        throw new Error(`no executable registry schema for ${actionType}`);
    }
    return schema.function;
}

describe('advertised gain ceilings match the acceptor that honours them', () => {
    it.each(gainSchemaCases)('$actionType system-prompt schema states the honoured range', (schemaCase) => {
        const toolFunction = systemPromptSchema(schemaCase.actionType);
        const accepts = acceptorFor(schemaCase);

        expectToolDescriptionHonoured(toolFunction, schemaCase.actionType, accepts);
        expectLinearGainFieldHonoured(toolFunction, schemaCase.actionType, accepts);
    });

    it.each(gainSchemaCases)('$actionType system-prompt schema states the honoured decibel range', (schemaCase) => {
        const toolFunction = systemPromptSchema(schemaCase.actionType);
        const gainDbDescription = descriptionOf(toolFunction, 'gainDb');
        if (gainDbDescription === null) {
            throw new Error(`${schemaCase.actionType} states no range for its decibel gain field`);
        }

        expectDecibelRangeHonoured(gainDbDescription, `${schemaCase.actionType} gainDb`, acceptorFor(schemaCase));
    });

    it.each(gainSchemaCases)('$actionType executable registry schema states the honoured range', (schemaCase) => {
        const toolFunction = registrySchema(schemaCase.actionType);
        const accepts = acceptorFor(schemaCase);

        expectToolDescriptionHonoured(toolFunction, schemaCase.actionType, accepts);
        expectLinearGainFieldHonoured(toolFunction, schemaCase.actionType, accepts);
    });
});
