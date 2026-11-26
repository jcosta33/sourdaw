import { isRecord } from '#/utils/structuralEquality';

import { TOASTER_KIT_STATE_VERSION, type toToasterKitState } from './ToasterKitState';

type Chunk = ReturnType<typeof toToasterKitState>;
type Fields = Chunk['data'];

export type ToasterMasterGainCapture =
    { kind: 'missing-chunk' } | { kind: 'missing-kit' } | { kind: 'missing-gain' } | { kind: 'value'; value: number };

type CurrentMaster = {
    chunk: Chunk | null;
    kit: Fields | null;
    capture: ToasterMasterGainCapture;
};

function isMap(value: unknown): value is Fields {
    return (
        isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    );
}

export function readToasterMasterGainState(chunk: Chunk | null): CurrentMaster | null {
    if (chunk === null) {
        return { chunk, kit: null, capture: { kind: 'missing-chunk' } };
    }
    if (
        !isMap(chunk) ||
        Object.keys(chunk).length !== 2 ||
        chunk.version !== TOASTER_KIT_STATE_VERSION ||
        !isMap(chunk.data)
    ) {
        return null;
    }
    if (!Object.hasOwn(chunk.data, 'kit')) {
        return { chunk, kit: null, capture: { kind: 'missing-kit' } };
    }
    const kit = chunk.data.kit;
    if (!isMap(kit)) {
        return null;
    }
    if (!Object.hasOwn(kit, 'masterGain')) {
        return { chunk, kit, capture: { kind: 'missing-gain' } };
    }
    const value = kit.masterGain;
    return typeof value === 'number' && Number.isFinite(value)
        ? { chunk, kit, capture: { kind: 'value', value } }
        : null;
}

function matchesMasterCapture(current: ToasterMasterGainCapture, expected: ToasterMasterGainCapture): boolean {
    switch (expected.kind) {
        case 'value':
            return current.kind === 'value' && current.value === expected.value;
        case 'missing-chunk':
            return current.kind !== 'value';
        case 'missing-kit':
            return current.kind === 'missing-kit' || current.kind === 'missing-gain';
        case 'missing-gain':
            return current.kind === 'missing-gain';
    }
}

/** Preserve siblings the current project holds, even when replaying an older edit. */
export function compileToasterMasterGainPatch(
    current: CurrentMaster,
    { before, after }: { before: ToasterMasterGainCapture; after: ToasterMasterGainCapture }
): { nextChunk: Chunk | null } | null {
    const { chunk, kit, capture } = current;
    if (!matchesMasterCapture(capture, before)) {
        return null;
    }
    if (after.kind === 'value') {
        return {
            nextChunk: {
                version: TOASTER_KIT_STATE_VERSION,
                data: { ...chunk?.data, kit: { ...kit, masterGain: after.value } },
            },
        };
    }
    if (!kit || !chunk) {
        return null;
    }

    const withoutGain = { ...kit };
    delete withoutGain.masterGain;
    if (after.kind === 'missing-gain' || Object.keys(withoutGain).length > 0) {
        return { nextChunk: { ...chunk, data: { ...chunk.data, kit: withoutGain } } };
    }
    const withoutKit = { ...chunk.data };
    delete withoutKit.kit;
    return {
        nextChunk:
            after.kind === 'missing-chunk' && Object.keys(withoutKit).length === 0
                ? null
                : { ...chunk, data: withoutKit },
    };
}
