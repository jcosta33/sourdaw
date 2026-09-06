import { type Doc, free, load } from '@automerge/automerge';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function readOptionalRecord(owner: UnknownRecord, key: string, path: string): UnknownRecord | undefined {
    if (!Object.hasOwn(owner, key)) {
        return undefined;
    }
    const value = owner[key];
    if (!isRecord(value)) {
        throw new TypeError(`[CheckpointRootMedia] Expected ${path} to be an object`);
    }
    return value;
}

function readOptionalArray(owner: UnknownRecord, key: string, path: string): unknown[] | undefined {
    if (!Object.hasOwn(owner, key)) {
        return undefined;
    }
    const value = owner[key];
    if (!isUnknownArray(value)) {
        throw new TypeError(`[CheckpointRootMedia] Expected ${path} to be an array`);
    }
    return value;
}

function readRecordItem(value: unknown, path: string): UnknownRecord {
    if (!isRecord(value)) {
        throw new TypeError(`[CheckpointRootMedia] Expected ${path} to be an object`);
    }
    return value;
}

function collectOptionalAudioReference(
    audioBufferIds: Set<string>,
    owner: UnknownRecord,
    key: string,
    path: string
): void {
    if (!Object.hasOwn(owner, key)) {
        return;
    }
    const value = owner[key];
    if (typeof value !== 'string') {
        throw new TypeError(`[CheckpointRootMedia] Expected ${path} to be a string`);
    }
    if (value.length > 0) {
        audioBufferIds.add(value);
    }
}

function collectClips(audioBufferIds: Set<string>, track: UnknownRecord, path: string): void {
    const clips = readOptionalArray(track, 'clips', `${path}.clips`);
    if (!clips) {
        return;
    }
    for (const [index, value] of clips.entries()) {
        const clip = readRecordItem(value, `${path}.clips[${index}]`);
        collectOptionalAudioReference(audioBufferIds, clip, 'audioBufferId', `${path}.clips[${index}].audioBufferId`);
    }
}

function collectTrack(audioBufferIds: Set<string>, value: unknown, path: string): void {
    const track = readRecordItem(value, path);
    collectClips(audioBufferIds, track, path);

    const alternatives = readOptionalArray(track, 'alternatives', `${path}.alternatives`);
    if (alternatives) {
        for (const [index, value] of alternatives.entries()) {
            const alternativePath = `${path}.alternatives[${index}]`;
            const alternative = readRecordItem(value, alternativePath);
            collectClips(audioBufferIds, alternative, alternativePath);
        }
    }

    const freezeState = readOptionalRecord(track, 'freezeState', `${path}.freezeState`);
    if (freezeState) {
        collectOptionalAudioReference(
            audioBufferIds,
            freezeState,
            'frozenBufferId',
            `${path}.freezeState.frozenBufferId`
        );
    }
    collectOptionalAudioReference(audioBufferIds, track, 'frozenBufferId', `${path}.frozenBufferId`);
}

function collectTrackSection(audioBufferIds: Set<string>, owner: UnknownRecord, key: string, path: string): void {
    const tracksSection = readOptionalRecord(owner, key, path);
    if (!tracksSection) {
        return;
    }
    const tracks = readOptionalArray(tracksSection, 'tracks', `${path}.tracks`);
    if (!tracks) {
        return;
    }
    for (const [index, track] of tracks.entries()) {
        collectTrack(audioBufferIds, track, `${path}.tracks[${index}]`);
    }
}

function collectArrangementTracks(audioBufferIds: Set<string>, root: UnknownRecord): void {
    const arrangementsSection = readOptionalRecord(root, 'arrangements', 'root.arrangements');
    if (!arrangementsSection) {
        return;
    }
    const arrangements = readOptionalArray(arrangementsSection, 'arrangements', 'root.arrangements.arrangements');
    if (!arrangements) {
        return;
    }
    for (const [index, value] of arrangements.entries()) {
        const arrangementPath = `root.arrangements.arrangements[${index}]`;
        const arrangement = readRecordItem(value, arrangementPath);
        collectTrackSection(audioBufferIds, arrangement, 'tracks', `${arrangementPath}.tracks`);
    }
}

export function inspectCheckpointRootMedia(rootBytes: Uint8Array): { audioBufferIds: string[] } {
    const root: Doc<UnknownRecord> = load<UnknownRecord>(rootBytes);
    try {
        const audioBufferIds = new Set<string>();
        collectTrackSection(audioBufferIds, root, 'tracks', 'root.tracks');
        collectArrangementTracks(audioBufferIds, root);
        return { audioBufferIds: [...audioBufferIds].sort() };
    } finally {
        free(root);
    }
}
