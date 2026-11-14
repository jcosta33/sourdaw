import { quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { type ToolCallResult } from '../../models/ToolCallResult';

import {
    VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME,
    VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME,
    type VibeBatchValuePair,
} from './buildVibeBatchValueRequest';

/** One parameter value as recipe expansion takes it. */
export type VibeBatchChosenValue = { readonly step: number; readonly paramId: string; readonly value: number };

/** The values one recipe-and-track pair of the batch expands with. */
export type VibeBatchPairValues = {
    readonly targetId: string;
    readonly recipeId: string;
    readonly values: readonly VibeBatchChosenValue[];
};

export type VibeBatchValueReply =
    | { status: 'chosen'; pairs: readonly VibeBatchPairValues[] }
    | { status: 'declined'; reason: string }
    | { status: 'rejected'; reason: string };

/** A declined reply's reason is shown on the card, so it is held to one short line. */
const DECLINE_REASON_MAX_CHARS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reject(reason: string): { status: 'rejected'; reason: string } {
    return { status: 'rejected', reason };
}

function pairKey(targetId: string, recipeId: string): string {
    return JSON.stringify([targetId, recipeId]);
}

function readDecline(call: ToolCallResult): VibeBatchValueReply {
    const reason = call.arguments.reason;
    if (typeof reason !== 'string' || reason.trim() === '') {
        return reject(`${VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME}.reason must be a non-empty string`);
    }
    return { status: 'declined', reason: reason.trim().replaceAll(/\s+/gu, ' ').slice(0, DECLINE_REASON_MAX_CHARS) };
}

type PairValuesRead = { status: 'read'; values: VibeBatchChosenValue[] } | { status: 'rejected'; reason: string };

/** Every parameter of the pair given once, inside its window, and still inside it once quantised. */
function readPairValues(pair: VibeBatchValuePair, entries: unknown, where: string): PairValuesRead {
    if (!Array.isArray(entries)) {
        return reject(`${where}.values must be an array`);
    }
    const given = new Map<string, number>();
    for (const [index, entry] of entries.entries()) {
        const at = `${where}.values[${String(index)}]`;
        if (!isRecord(entry) || typeof entry.step !== 'number' || typeof entry.paramId !== 'string') {
            return reject(`${at} must carry a numeric step and a string paramId`);
        }
        const step = entry.step;
        const paramId = entry.paramId;
        const value = entry.value;
        if (!pair.parameters.some((parameter) => parameter.step === step)) {
            return reject(`${at}.step ${String(step)} is not a step of recipe ${pair.recipeId}`);
        }
        const parameter = pair.parameters.find((candidate) => candidate.step === step && candidate.paramId === paramId);
        if (parameter === undefined) {
            return reject(`${at}.paramId ${paramId} is not a parameter of step ${String(step)} of ${pair.recipeId}`);
        }
        const key = pairKey(String(step), paramId);
        if (given.has(key)) {
            return reject(`${at} gives ${paramId} of step ${String(step)} a second value`);
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return reject(`${at}.value must be a finite number`);
        }
        if (value < parameter.minimum || value > parameter.maximum) {
            return reject(
                `${at}.value ${String(value)} is outside the window ${String(parameter.minimum)} to ${String(parameter.maximum)} of ${paramId}`
            );
        }
        const quantised = quantiseDeviceParameterValue({ deviceType: parameter.deviceType, paramId, value });
        if (quantised < parameter.minimum || quantised > parameter.maximum) {
            return reject(
                `${at}.value ${String(value)} becomes the legal setting ${String(quantised)}, outside the window ${String(parameter.minimum)} to ${String(parameter.maximum)} of ${paramId}`
            );
        }
        given.set(key, quantised);
    }
    const values: VibeBatchChosenValue[] = [];
    for (const parameter of pair.parameters) {
        const value = given.get(pairKey(String(parameter.step), parameter.paramId));
        if (value === undefined) {
            return reject(`${where}.values is missing ${parameter.paramId} of step ${String(parameter.step)}`);
        }
        values.push({ step: parameter.step, paramId: parameter.paramId, value });
    }
    return { status: 'read', values };
}

function readChoices(pairs: readonly VibeBatchValuePair[], call: ToolCallResult): VibeBatchValueReply {
    const choices = call.arguments.choices;
    if (!Array.isArray(choices)) {
        return reject(`${VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME}.choices must be an array`);
    }
    const chosen = new Map<string, VibeBatchPairValues>();
    for (const [index, choice] of choices.entries()) {
        const where = `choices[${String(index)}]`;
        if (!isRecord(choice) || typeof choice.targetId !== 'string' || typeof choice.recipeId !== 'string') {
            return reject(`${where} must carry a string targetId and recipeId`);
        }
        const { targetId, recipeId } = choice;
        if (!pairs.some((pair) => pair.targetId === targetId)) {
            return reject(`${where}.targetId ${targetId} is not a target of this batch`);
        }
        const pair = pairs.find((candidate) => candidate.targetId === targetId && candidate.recipeId === recipeId);
        if (pair === undefined) {
            return reject(`${where}.recipeId ${recipeId} is not assigned to target ${targetId}`);
        }
        const key = pairKey(targetId, recipeId);
        if (chosen.has(key)) {
            return reject(`${where} gives ${recipeId} on ${targetId} a second time`);
        }
        const read = readPairValues(pair, choice.values, where);
        if (read.status === 'rejected') {
            return read;
        }
        chosen.set(key, { targetId, recipeId, values: read.values });
    }
    const ordered: VibeBatchPairValues[] = [];
    for (const pair of pairs) {
        const values = chosen.get(pairKey(pair.targetId, pair.recipeId));
        if (values === undefined) {
            return reject(`choices is missing ${pair.recipeId} on ${pair.targetId}`);
        }
        ordered.push(values);
    }
    return { status: 'chosen', pairs: ordered };
}

/**
 * Reads a hosted reply to a vibe batch's value request whole: exactly one call of one of the two
 * tools. A choice must give every pair of the batch, and every parameter of each, exactly once and
 * inside its authored window, also after quantisation onto a legal setting; any single fault refuses
 * the whole reply with one reason naming the field, so nothing of it is applied.
 */
export function readVibeBatchValueReply(
    pairs: readonly VibeBatchValuePair[],
    calls: readonly ToolCallResult[]
): VibeBatchValueReply {
    const [call, ...rest] = calls;
    if (call === undefined) {
        return reject(
            `the reply called no tool; call ${VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME} or ${VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME}`
        );
    }
    if (rest.length > 0) {
        return reject('the reply made more than one call; call exactly one tool, once');
    }
    if (call.argumentSchemaViolation !== undefined) {
        return reject(
            `${call.name} arguments miss its schema at ${call.argumentSchemaViolation.path || '/'} (${call.argumentSchemaViolation.kind})`
        );
    }
    if (call.name === VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME) {
        return readDecline(call);
    }
    if (call.name !== VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME) {
        return reject(`the reply called ${call.name}, which this request did not offer`);
    }
    return readChoices(pairs, call);
}
