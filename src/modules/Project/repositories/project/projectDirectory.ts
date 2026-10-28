const FORMAT = 'sourdaw-project-directory-v1';
const MANIFEST = 'manifest.json';
const PREVIOUS_MANIFEST = 'manifest.previous.json';

type StoredFile = { path: string; sha256: string; byteLength: number };

type ProjectFileHandle = {
    getFile: () => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
    createWritable: () => Promise<{
        write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
        close: () => Promise<void>;
        abort: () => Promise<void>;
    }>;
};

export type ProjectDirectoryHandle = {
    getFileHandle: (name: string, options?: { create?: boolean }) => Promise<ProjectFileHandle>;
    getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<ProjectDirectoryHandle>;
};

export type ProjectMediaFile = StoredFile & {
    assetHash: string;
};

export type ProjectPcmBuffer = {
    bufferId: string;
    sampleRate: number;
    channels: StoredFile[];
    freezeProjectId?: number;
};

export type ProjectDirectoryManifest = {
    format: typeof FORMAT;
    projectId: string;
    generation: string;
    document: StoredFile;
    snapshot: StoredFile;
    media: ProjectMediaFile[];
    unavailableOriginals: string[];
    pcm: ProjectPcmBuffer[];
};

export type ProjectDirectoryContent = {
    manifest: ProjectDirectoryManifest;
    document: Uint8Array;
    snapshot: string;
    media: Map<string, Uint8Array>;
    pcm: Map<string, { sampleRate: number; channels: Uint8Array[]; freezeProjectId?: number }>;
};

type WriteProjectDirectoryInput = {
    directory: ProjectDirectoryHandle;
    projectId: string;
    document: Uint8Array;
    snapshot: string;
    media: ReadonlyMap<string, Blob>;
    unavailableOriginals: readonly string[];
    pcm: ReadonlyMap<string, AudioBuffer>;
    freezeProjectIdByBufferId?: ReadonlyMap<string, number>;
    isCurrent: () => boolean;
};

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
    return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function fileNameForHash(prefix: string, hash: string, extension: string): string {
    if (!isSha256(hash)) {
        throw new Error('Invalid project media hash');
    }
    return `${prefix}.${hash.slice(7)}.${extension}`;
}

function isStoredFile(value: unknown): value is StoredFile {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const file = value as Record<string, unknown>;
    return (
        typeof file.path === 'string' &&
        typeof file.byteLength === 'number' &&
        Number.isSafeInteger(file.byteLength) &&
        file.byteLength > 0 &&
        isSha256(file.sha256)
    );
}

function parseManifest(value: unknown, projectId: string): ProjectDirectoryManifest {
    if (typeof value !== 'object' || value === null) {
        throw new Error('Project manifest is not an object');
    }
    const manifest = value as Record<string, unknown>;
    if (
        manifest.format !== FORMAT ||
        manifest.projectId !== projectId ||
        typeof manifest.generation !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(manifest.generation) ||
        !isStoredFile(manifest.document) ||
        !isStoredFile(manifest.snapshot) ||
        !Array.isArray(manifest.media) ||
        !Array.isArray(manifest.unavailableOriginals) ||
        !Array.isArray(manifest.pcm)
    ) {
        throw new Error('Project manifest has an unsupported shape');
    }
    const document = manifest.document;
    const snapshot = manifest.snapshot;
    if (
        document.path !== fileNameForHash('document', document.sha256, 'sdaw') ||
        snapshot.path !== fileNameForHash('snapshot', snapshot.sha256, 'json')
    ) {
        throw new Error('Project manifest names an invalid document');
    }
    const media: ProjectMediaFile[] = [];
    const seen = new Set<string>();
    for (const value of manifest.media) {
        if (typeof value !== 'object' || value === null || !isStoredFile(value)) {
            throw new Error('Project manifest names invalid media');
        }
        const file = value as unknown as Record<string, unknown>;
        if (
            !isSha256(file.assetHash) ||
            file.sha256 !== file.assetHash ||
            file.path !== `media/${fileNameForHash('asset', file.assetHash, 'bin')}` ||
            seen.has(file.assetHash)
        ) {
            throw new Error('Project manifest names invalid media');
        }
        seen.add(file.assetHash);
        media.push(value as ProjectMediaFile);
    }
    const unavailableOriginals: string[] = [];
    for (const hash of manifest.unavailableOriginals) {
        if (!isSha256(hash) || seen.has(hash) || unavailableOriginals.includes(hash)) {
            throw new Error('Project manifest names invalid unavailable original');
        }
        unavailableOriginals.push(hash);
    }
    const pcm: ProjectPcmBuffer[] = [];
    const seenPcm = new Set<string>();
    for (const value of manifest.pcm) {
        if (typeof value !== 'object' || value === null) {
            throw new Error('Project manifest names invalid PCM');
        }
        const entry = value as Record<string, unknown>;
        if (
            typeof entry.bufferId !== 'string' ||
            entry.bufferId.length === 0 ||
            seenPcm.has(entry.bufferId) ||
            typeof entry.sampleRate !== 'number' ||
            !Number.isFinite(entry.sampleRate) ||
            entry.sampleRate <= 0 ||
            !Array.isArray(entry.channels) ||
            entry.channels.length === 0 ||
            entry.channels.length > 32 ||
            (entry.freezeProjectId !== undefined &&
                (typeof entry.freezeProjectId !== 'number' ||
                    !Number.isSafeInteger(entry.freezeProjectId) ||
                    entry.freezeProjectId <= 0))
        ) {
            throw new Error('Project manifest names invalid PCM');
        }
        const channels: StoredFile[] = [];
        for (const channel of entry.channels) {
            if (
                !isStoredFile(channel) ||
                channel.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0 ||
                channel.path !== `pcm/${fileNameForHash('channel', channel.sha256, 'f32le')}`
            ) {
                throw new Error('Project manifest names invalid PCM');
            }
            channels.push(channel);
        }
        seenPcm.add(entry.bufferId);
        const parsed: ProjectPcmBuffer = {
            bufferId: entry.bufferId,
            sampleRate: entry.sampleRate,
            channels,
        };
        if (typeof entry.freezeProjectId === 'number') {
            parsed.freezeProjectId = entry.freezeProjectId;
        }
        pcm.push(parsed);
    }
    return {
        format: FORMAT,
        projectId,
        generation: manifest.generation,
        document,
        snapshot,
        media,
        unavailableOriginals,
        pcm,
    };
}

async function readFile(directory: ProjectDirectoryHandle, name: string): Promise<Uint8Array> {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
}

async function readVerifiedFile(directory: ProjectDirectoryHandle, entry: StoredFile): Promise<Uint8Array> {
    let parent = directory;
    let name = entry.path;
    if (entry.path.startsWith('media/')) {
        parent = await directory.getDirectoryHandle('media');
        name = entry.path.slice(6);
    } else if (entry.path.startsWith('pcm/')) {
        parent = await directory.getDirectoryHandle('pcm');
        name = entry.path.slice(4);
    }
    const bytes = await readFile(parent, name);
    if (bytes.byteLength !== entry.byteLength || (await hashBytes(bytes)) !== entry.sha256) {
        throw new Error(`Project file failed integrity verification: ${entry.path}`);
    }
    return bytes;
}

async function writeFile(
    directory: ProjectDirectoryHandle,
    name: string,
    bytes: Uint8Array,
    isCurrent: () => boolean
): Promise<void> {
    if (!isCurrent()) {
        throw new Error('Project changed before media write');
    }
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
        if (!isCurrent()) {
            throw new Error('Project changed before media write');
        }
        const writeBytes = new Uint8Array(bytes.byteLength);
        writeBytes.set(bytes);
        await writable.write(writeBytes);
        if (!isCurrent()) {
            throw new Error('Project changed before media write');
        }
        await writable.close();
    } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
    }
}

async function writeContentFile(
    directory: ProjectDirectoryHandle,
    name: string,
    bytes: Uint8Array,
    isCurrent: () => boolean
): Promise<void> {
    try {
        const present = await readFile(directory, name);
        if ((await hashBytes(present)) !== (await hashBytes(bytes))) {
            throw new Error(`Existing project content differs: ${name}`);
        }
        return;
    } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
            throw error;
        }
    }
    await writeFile(directory, name, bytes, isCurrent);
    const written = await readFile(directory, name);
    if ((await hashBytes(written)) !== (await hashBytes(bytes))) {
        throw new Error(`Project content failed verification after write: ${name}`);
    }
}

/** Read and verify the committed generation, falling back to the previous valid manifest. */
export async function readProjectDirectory(
    directory: ProjectDirectoryHandle,
    projectId: string
): Promise<ProjectDirectoryContent> {
    let firstError: unknown;
    for (const name of [MANIFEST, PREVIOUS_MANIFEST]) {
        try {
            const rawManifest = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(directory, name));
            const manifest = parseManifest(JSON.parse(rawManifest), projectId);
            const document = await readVerifiedFile(directory, manifest.document);
            const snapshotBytes = await readVerifiedFile(directory, manifest.snapshot);
            const media = new Map<string, Uint8Array>();
            for (const entry of manifest.media) {
                media.set(entry.assetHash, await readVerifiedFile(directory, entry));
            }
            const pcm = new Map<string, { sampleRate: number; channels: Uint8Array[]; freezeProjectId?: number }>();
            for (const entry of manifest.pcm) {
                const channels = await Promise.all(
                    entry.channels.map((channel) => readVerifiedFile(directory, channel))
                );
                if (channels.some((channel) => channel.byteLength !== channels[0]?.byteLength)) {
                    throw new Error(`Project PCM channels differ in length: ${entry.bufferId}`);
                }
                pcm.set(entry.bufferId, {
                    sampleRate: entry.sampleRate,
                    channels,
                    freezeProjectId: entry.freezeProjectId,
                });
            }
            return {
                manifest,
                document,
                snapshot: new TextDecoder('utf-8', { fatal: true }).decode(snapshotBytes),
                media,
                pcm,
            };
        } catch (error) {
            firstError ??= error;
        }
    }
    throw new Error('No valid project manifest generation is available', { cause: firstError });
}

/** Write immutable content first and replace the small manifest only after every byte is verified. */
export async function writeProjectDirectory({
    directory,
    projectId,
    document,
    snapshot,
    media,
    unavailableOriginals,
    pcm,
    freezeProjectIdByBufferId,
    isCurrent,
}: WriteProjectDirectoryInput): Promise<ProjectDirectoryManifest> {
    const encoder = new TextEncoder();
    const snapshotBytes = encoder.encode(snapshot);
    const documentHash = await hashBytes(document);
    const snapshotHash = await hashBytes(snapshotBytes);
    const documentEntry = {
        path: fileNameForHash('document', documentHash, 'sdaw'),
        sha256: documentHash,
        byteLength: document.byteLength,
    };
    const snapshotEntry = {
        path: fileNameForHash('snapshot', snapshotHash, 'json'),
        sha256: snapshotHash,
        byteLength: snapshotBytes.byteLength,
    };
    await writeContentFile(directory, documentEntry.path, document, isCurrent);
    await writeContentFile(directory, snapshotEntry.path, snapshotBytes, isCurrent);

    const mediaDirectory = await directory.getDirectoryHandle('media', { create: true });
    const mediaEntries: ProjectMediaFile[] = [];
    for (const [assetHash, blob] of media) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if ((await hashBytes(bytes)) !== assetHash) {
            throw new Error(`Project original media does not match its asset hash: ${assetHash}`);
        }
        const name = fileNameForHash('asset', assetHash, 'bin');
        await writeContentFile(mediaDirectory, name, bytes, isCurrent);
        mediaEntries.push({
            assetHash,
            path: `media/${name}`,
            sha256: assetHash,
            byteLength: bytes.byteLength,
        });
    }

    const pcmDirectory = await directory.getDirectoryHandle('pcm', { create: true });
    const pcmEntries: ProjectPcmBuffer[] = [];
    for (const [bufferId, buffer] of pcm) {
        const channels: StoredFile[] = [];
        for (let index = 0; index < buffer.numberOfChannels; index++) {
            const samples = buffer.getChannelData(index);
            const bytes = new Uint8Array(samples.byteLength);
            bytes.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
            const hash = await hashBytes(bytes);
            const name = fileNameForHash('channel', hash, 'f32le');
            await writeContentFile(pcmDirectory, name, bytes, isCurrent);
            channels.push({ path: `pcm/${name}`, sha256: hash, byteLength: bytes.byteLength });
        }
        pcmEntries.push({
            bufferId,
            sampleRate: buffer.sampleRate,
            channels,
            freezeProjectId: freezeProjectIdByBufferId?.get(bufferId),
        });
    }

    let previousManifest: Uint8Array | null = null;
    try {
        const bytes = await readFile(directory, MANIFEST);
        const valid = await readProjectDirectory(directory, projectId);
        try {
            const current = parseManifest(
                JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
                projectId
            );
            previousManifest =
                current.generation === valid.manifest.generation ? bytes : await readFile(directory, PREVIOUS_MANIFEST);
        } catch {
            previousManifest = await readFile(directory, PREVIOUS_MANIFEST);
        }
    } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
            throw error;
        }
    }
    if (previousManifest) {
        await writeFile(directory, PREVIOUS_MANIFEST, previousManifest, isCurrent);
    }
    const manifest: ProjectDirectoryManifest = {
        format: FORMAT,
        projectId,
        generation: crypto.randomUUID(),
        document: documentEntry,
        snapshot: snapshotEntry,
        media: mediaEntries,
        unavailableOriginals: [...unavailableOriginals],
        pcm: pcmEntries,
    };
    const manifestBytes = encoder.encode(JSON.stringify(manifest));
    await writeFile(directory, MANIFEST, manifestBytes, isCurrent);
    const committed = await readFile(directory, MANIFEST);
    if ((await hashBytes(committed)) !== (await hashBytes(manifestBytes))) {
        throw new Error('Project manifest failed verification after commit');
    }
    if (!isCurrent()) {
        throw new Error('Project changed after manifest commit');
    }
    return manifest;
}
