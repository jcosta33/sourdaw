import { isRecord } from '#/utils/structuralEquality';

export function isRemoveClipSessionPayload(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        (!Object.hasOwn(value, 'ripple') || typeof value.ripple === 'boolean') &&
        Object.keys(value).every((key) => key === 'clipId' || key === 'ripple')
    );
}
