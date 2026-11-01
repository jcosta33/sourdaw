type UnknownRecord = Record<string, unknown>;

const AUDIO_BUFFER_FIELD = /(?:^b|B)ufferIds?$/;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null;
}

/** Buffer references are named by convention: `audioBufferId`, `frozenBufferId`,
 * `reversedBufferId`, a legacy clip's `bufferId`, a declared `restoresBufferIds`. */
function namesAudioBuffer(key: string): boolean {
    return AUDIO_BUFFER_FIELD.test(key);
}

/** A string, plain or as the time-operation codec's encoded `{ type: 'string', value }` node. */
function readIdString(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (isRecord(value) && value.type === 'string' && typeof value.value === 'string') {
        return value.value;
    }
    return undefined;
}

/** The ids a buffer-named field holds: one string or a list of them, plain or codec-encoded. */
function readIdStrings(value: unknown): string[] {
    const single = readIdString(value);
    if (single !== undefined) {
        return [single];
    }
    const items = Array.isArray(value)
        ? value
        : isRecord(value) && value.type === 'array' && Array.isArray(value.items)
          ? value.items
          : [];
    return items.flatMap((item) => {
        const id = readIdString(item);
        return id === undefined ? [] : [id];
    });
}

/**
 * Every audio buffer id anywhere inside `value`, found by field name rather than
 * by payload shape, so a payload type added later is covered without a new case.
 *
 * Fields are matched both as plain properties and as the time-operation codec's
 * encoded object entries (`{ key, value: { type: 'string', value } }`), which is
 * how a restore plan carries whole track state; a walk over plain keys alone
 * would not see a clip inside one. The walk is iterative with a visited set, so
 * no payload depth truncates it and shared references are read once. Typed
 * arrays (PCM, peaks) hold no ids and are skipped.
 */
export function collectAudioBufferIdFields(value: unknown): string[] {
    const ids = new Set<string>();
    const visited = new Set<object>();
    const pending: unknown[] = [value];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!isRecord(current) || visited.has(current) || ArrayBuffer.isView(current)) {
            continue;
        }
        visited.add(current);
        if (Array.isArray(current)) {
            for (const item of current) {
                pending.push(item);
            }
            continue;
        }
        if (typeof current.key === 'string' && namesAudioBuffer(current.key)) {
            for (const id of readIdStrings(current.value)) {
                ids.add(id);
            }
        }
        for (const [key, child] of Object.entries(current)) {
            if (namesAudioBuffer(key)) {
                for (const id of readIdStrings(child)) {
                    ids.add(id);
                }
            }
            pending.push(child);
        }
    }
    return [...ids];
}
