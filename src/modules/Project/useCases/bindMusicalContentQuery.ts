import { type captureMusicalContentBinding } from './captureMusicalContentBinding';
import { parseSemanticProjectQueryInput } from './parseSemanticProjectQueryInput';

/** Bind private application evidence to model-supplied query data before the owner parser. */
export function bindMusicalContentQuery(value: unknown, binding: ReturnType<typeof captureMusicalContentBinding>) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { status: 'invalid', reason: 'arguments' } as const;
    }
    if (
        'expectedRevision' in value ||
        'selectionToken' in value ||
        !('type' in value) ||
        value.type !== 'musical-content'
    ) {
        return { status: 'invalid', reason: 'arguments' } as const;
    }
    return parseSemanticProjectQueryInput({ ...value, ...binding });
}
