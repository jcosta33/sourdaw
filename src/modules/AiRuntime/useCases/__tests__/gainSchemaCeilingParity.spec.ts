import { describe, expect, it } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

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
 * That measurement fixes the contract these two descriptions live under: every
 * number they state is a **linear gain**. A figure in another unit — `+6 dB`,
 * a percentage — reads here as a gain the acceptor is expected to honour, and
 * reds. Say it in the gain scale, or say it without a number.
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

function advertisedGains(toolFunction: ToolFunction): number[] {
    const gainProperty = toolFunction.parameters.properties.gain;
    const gainDescription =
        typeof gainProperty === 'object' && gainProperty !== null && 'description' in gainProperty
            ? String(gainProperty.description)
            : '';
    const text = `${toolFunction.description} ${gainDescription}`;
    return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
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

function expectSchemaMatchesAcceptor(toolFunction: ToolFunction, accepts: (gain: number) => boolean): void {
    const advertised = advertisedGains(toolFunction);
    expect(advertised.length, `"${toolFunction.description}" advertises no gain range`).toBeGreaterThan(0);

    for (const gain of advertised) {
        expect(accepts(gain), `schema advertises ${String(gain)}, which the acceptor rejects`).toBe(true);
    }
    expect(Math.max(...advertised)).toBeCloseTo(measureAcceptorCeiling(accepts), 2);
}

describe('advertised gain ceilings match the acceptor that honours them', () => {
    it.each(gainSchemaCases)('$actionType system-prompt schema states the honoured range', (schemaCase) => {
        const schema = DAW_TOOL_SCHEMAS.find((candidate) => candidate.function.name === schemaCase.actionType);
        if (!schema) {
            throw new Error(`no system-prompt tool schema for ${schemaCase.actionType}`);
        }

        expectSchemaMatchesAcceptor(schema.function, acceptorFor(schemaCase));
    });

    it.each(gainSchemaCases)('$actionType executable registry schema states the honoured range', (schemaCase) => {
        const schema = getExecutableAppActionToolSchemas().find(
            (candidate) => candidate.function.name === schemaCase.actionType
        );
        if (!schema) {
            throw new Error(`no executable registry schema for ${schemaCase.actionType}`);
        }

        expectSchemaMatchesAcceptor(schema.function, acceptorFor(schemaCase));
    });
});
