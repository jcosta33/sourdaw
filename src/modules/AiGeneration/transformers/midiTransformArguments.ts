import { createAiGenerationError } from '../errors/AiGenerationError';

/**
 * Argument readers for the MIDI transform adapters.
 *
 * The command contract already validated every argument against the transform's published schema, so
 * a value missing or out of domain here means the two sides have drifted apart. That is a defect, not
 * a user error: the adapter throws rather than substituting a value the proposal never stated, and
 * the expansion turns the throw into a refusal naming the transform.
 */

function fail(transform: string, message: string): never {
    throw createAiGenerationError(`${transform} transform received ${message}`);
}

export function readTransformNumber(input: {
    argumentName: string;
    maximum: number;
    minimum: number;
    transform: string;
    value: unknown;
}): number {
    const { argumentName, maximum, minimum, transform, value } = input;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(transform, `${argumentName} outside its supported domain`);
    }
    return value;
}

export function readTransformInteger(input: {
    argumentName: string;
    maximum: number;
    minimum: number;
    transform: string;
    value: unknown;
}): number {
    const value = readTransformNumber(input);
    if (!Number.isInteger(value)) {
        fail(input.transform, `a non-integer ${input.argumentName}`);
    }
    return value;
}

export function readTransformChoice<Choice extends string>(input: {
    argumentName: string;
    choices: readonly Choice[];
    transform: string;
    value: unknown;
}): Choice {
    const { argumentName, choices, transform, value } = input;
    const choice = choices.find((candidate) => candidate === value);
    if (choice === undefined) {
        fail(transform, `an unsupported ${argumentName}`);
    }
    return choice;
}
