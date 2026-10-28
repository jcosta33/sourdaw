import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import {
    PARSE_ERROR_KINDS,
    type ParseSclError,
    type ParseSclOutput,
    type ParseSclResult,
    STANDARD_A4_ROOT_FREQ,
    STANDARD_A4_ROOT_NOTE,
} from '../../models/ScalaTuning';
import { parseSclContent } from '../../services/parseSclContent';

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((frequency) => Number.isFinite(frequency));
}

function isParseSclOutput(value: unknown): value is ParseSclOutput {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }

    if (!('description' in value) || typeof value.description !== 'string') {
        return false;
    }

    if (!('frequencies' in value) || !isNumberArray(value.frequencies)) {
        return false;
    }

    return true;
}

function isParseSclError(value: unknown): value is ParseSclError {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('kind' in value) || !PARSE_ERROR_KINDS.some((kind) => kind === value.kind)) {
        return false;
    }
    if (!('line' in value) || typeof value.line !== 'number' || !Number.isSafeInteger(value.line) || value.line <= 0) {
        return false;
    }
    if (!('reason' in value) || typeof value.reason !== 'string') {
        return false;
    }
    return (
        value.reason.length > 0 &&
        value.reason.length <= 200 &&
        value.reason.trim() === value.reason &&
        !/\p{Cc}/u.test(value.reason)
    );
}

export async function parseScl(content: string): Promise<ParseSclResult> {
    if (!isDesktopRuntime()) {
        return parseSclContent(content);
    }
    const result = await desktopInvoke('parse_scl', {
        content,
        rootNote: STANDARD_A4_ROOT_NOTE,
        rootFreq: STANDARD_A4_ROOT_FREQ,
    });

    if (typeof result === 'object' && result !== null && 'error' in result) {
        if (!isParseSclError(result.error)) {
            throw new TypeError('parse_scl returned an invalid error payload');
        }
        return { status: 'invalid', error: result.error };
    }
    if (!isParseSclOutput(result)) {
        throw new TypeError('parse_scl returned an invalid payload');
    }

    return { status: 'parsed', scale: result };
}
