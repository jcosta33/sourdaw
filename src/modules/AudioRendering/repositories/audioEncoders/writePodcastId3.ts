type PodcastMetadata = {
    title: string;
    artist: string;
    description: string;
};

const MAX_TAG_BODY_BYTES = 32768;

function synchsafe(size: number): number[] {
    return [(size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f];
}

function encodeField(value: string, label: string, byteLimit: number, multiline = false): Uint8Array {
    if (value.length > byteLimit) {
        throw new Error(`${label} must be at most ${byteLimit} UTF-8 bytes.`);
    }
    if (value.includes('\0') || (!multiline && /[\r\n]/u.test(value))) {
        throw new Error(`${label} contains an unsupported text separator.`);
    }
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > byteLimit) {
        throw new Error(`${label} must be at most ${byteLimit} UTF-8 bytes.`);
    }
    return bytes;
}

function frame(id: string, text: Uint8Array, prefix: readonly number[]): Uint8Array {
    const size = prefix.length + text.length;
    const bytes = new Uint8Array(10 + size);
    bytes.set(new TextEncoder().encode(id));
    bytes.set(synchsafe(size), 4);
    bytes.set(prefix, 10);
    bytes.set(text, 10 + prefix.length);
    return bytes;
}

/** ID3v2.4 UTF-8 frames precede the MPEG stream; audio bytes are never rewritten. */
export function writePodcastId3(input: { metadata: PodcastMetadata; encodedBytes: Uint8Array }): Uint8Array {
    const title = encodeField(input.metadata.title, 'Episode title', 4096);
    const artist = encodeField(input.metadata.artist, 'Artist', 4096);
    const description = encodeField(input.metadata.description, 'Description', 16384, true);
    const frames: Uint8Array[] = [];
    if (title.length > 0) {
        frames.push(frame('TIT2', title, [3]));
    }
    if (artist.length > 0) {
        frames.push(frame('TPE1', artist, [3]));
    }
    if (description.length > 0) {
        // ISO 639-2 undetermined language, then an empty UTF-8 short description.
        frames.push(frame('COMM', description, [3, 117, 110, 100, 0]));
    }
    const bodySize = frames.reduce((sum, current) => sum + current.length, 0);
    if (bodySize === 0) {
        return input.encodedBytes;
    }
    if (bodySize > MAX_TAG_BODY_BYTES) {
        throw new Error(`Podcast metadata must fit in ${MAX_TAG_BODY_BYTES} bytes.`);
    }
    const bytes = new Uint8Array(10 + bodySize + input.encodedBytes.length);
    bytes.set([73, 68, 51, 4, 0, 0, ...synchsafe(bodySize)]);
    let offset = 10;
    for (const current of frames) {
        bytes.set(current, offset);
        offset += current.length;
    }
    bytes.set(input.encodedBytes, offset);
    return bytes;
}
