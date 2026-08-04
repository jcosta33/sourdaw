import { createAiRuntimeError } from '../errors/AiRuntimeError';

import type { ToolCallResult } from '../transformers/toolCallParser';

type GeneratedMidiNote = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity?: number;
};

type RequireMidiNoteGenerationToolCallInput = {
    toolCalls: readonly ToolCallResult[];
    expectedClipId: string;
    allowNegativeStartBeat?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Reflect.ownKeys(value);
    return (
        actualKeys.length === expectedKeys.length &&
        actualKeys.every((key) => typeof key === 'string' && expectedKeys.includes(key))
    );
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isGeneratedMidiNote(value: unknown, allowNegativeStartBeat: boolean): value is GeneratedMidiNote {
    if (!isRecord(value)) {
        return false;
    }

    const hasRequiredKeys =
        hasExactKeys(value, ['pitch', 'startBeat', 'duration']) ||
        hasExactKeys(value, ['pitch', 'startBeat', 'duration', 'velocity']);
    if (
        !hasRequiredKeys ||
        !isFiniteNumber(value.pitch) ||
        value.pitch < 0 ||
        value.pitch > 127 ||
        !isFiniteNumber(value.startBeat) ||
        (!allowNegativeStartBeat && value.startBeat < 0) ||
        !isFiniteNumber(value.duration) ||
        value.duration <= 0 ||
        (value.velocity !== undefined &&
            (!isFiniteNumber(value.velocity) || value.velocity < 1 || value.velocity > 127))
    ) {
        return false;
    }

    return true;
}

export function requireMidiNoteGenerationToolCall({
    toolCalls,
    expectedClipId,
    allowNegativeStartBeat = false,
}: RequireMidiNoteGenerationToolCallInput): GeneratedMidiNote[] {
    const [toolCall] = toolCalls;
    if (toolCalls.length !== 1 || !toolCall || toolCall.name !== 'addNotes') {
        throw createAiRuntimeError('AI MIDI generation requires exactly one addNotes tool call.');
    }

    const { arguments: toolArguments } = toolCall;
    if (
        !hasExactKeys(toolArguments, ['clipId', 'notes']) ||
        typeof toolArguments.clipId !== 'string' ||
        toolArguments.clipId.trim().length === 0 ||
        !Array.isArray(toolArguments.notes) ||
        toolArguments.notes.length === 0 ||
        !toolArguments.notes.every((note) => isGeneratedMidiNote(note, allowNegativeStartBeat))
    ) {
        throw createAiRuntimeError('AI MIDI generation requires a valid non-empty MIDI note list.');
    }

    if (toolArguments.clipId !== expectedClipId) {
        throw createAiRuntimeError('AI MIDI generation must target the requested clip.');
    }

    return toolArguments.notes;
}
