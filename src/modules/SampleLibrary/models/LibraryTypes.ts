/**
 * Core types for the local-first sample library.
 *
 * The user's filesystem is the source of truth. We store only references,
 * derived metadata, and user tags — never duplicate audio files.
 */

// ── File provider abstraction ────────────────────────────────────────────────

/**
 * Which file provider backs a library root: the browser's File System Access
 * handles, or the desktop shell's native filesystem.
 *
 * Roots connected before the desktop shell moved off Tauri persisted this
 * kind under the old `'tauri'` spelling. Reading that legacy value is the
 * persistence layer's job; nothing outside it ever sees the old spelling.
 */
export type FileProviderKind = 'browser' | 'desktop';

export type FileEntry = {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    lastModified?: number;
};

export type FileStat = {
    size: number;
    lastModified: number;
    exists: boolean;
};

// ── Library root ─────────────────────────────────────────────────────────────

/**
 * Connection state of a library root.
 *
 * - `ready`            — accessible; samples can be previewed and dragged out.
 * - `scanning`         — an indexing pass is in progress.
 * - `permission_required` — a browser handle exists but read permission lapsed
 *   (re-grantable via the OS picker without re-selecting the folder).
 * - `path_missing`     — a native root whose absolute path no longer resolves on
 *   disk (folder moved/deleted); distinct from a transient access failure.
 * - `offline`          — the root cannot be reached right now for any other
 *   reason (handle lost, IO error). Catch-all not-ready state.
 *
 * Only `ready` is the operable state; `isRootReady` is the single discriminator
 * callers should use rather than testing for the absence of a handle.
 */
export type LibraryRootStatus = 'ready' | 'offline' | 'permission_required' | 'path_missing' | 'scanning';

/** True only when a root is in its single operable state. */
export function isRootReady(root: Pick<LibraryRoot, 'status'>): boolean {
    return root.status === 'ready';
}

export type LibraryRoot = {
    id: string;
    name: string;
    provider: FileProviderKind;
    /** Browser: serialized FileSystemDirectoryHandle key; native: absolute path */
    rootRef: string;
    /** Browser FileSystemDirectoryHandle (runtime only, not serialized) */
    handle?: FileSystemDirectoryHandle;
    connectedAt: number;
    lastScanAt?: number;
    status: LibraryRootStatus;
    fileCount: number;
    settings: {
        recursive: boolean;
    };
};

// ── Sample record ────────────────────────────────────────────────────────────

export type SampleSyncStatus = 'discovered' | 'indexed' | 'analyzed' | 'offline' | 'error';

export type SpectralDescriptors = {
    centroid?: number;
    flatness?: number;
    crest?: number;
    rms?: number;
    transientDensity?: number;
    inharmonicity?: number;
};

// ── Branded musical-metadata primitives ──────────────────────────────────────
//
// Branding closes the door on the values that the old bare `number`/`string`
// fields silently admitted: a negative or absurd BPM, or a free-text key like
// 'banana'. Each brand has exactly one constructor that validates its input and
// returns `undefined` when the value is out of range, so an invalid value can
// never reach a `SampleAnalysis`.

declare const bpmBrand: unique symbol;
/** A musical tempo in beats per minute, validated to a sane positive range. */
export type Bpm = number & { readonly [bpmBrand]: true };

/** Plausible musical tempo bounds; analysis or user input outside this is dropped. */
const MIN_BPM = 20;
const MAX_BPM = 400;

/** Construct a {@link Bpm}, or `undefined` if the value is not a sane tempo. */
export function toBpm(value: number): Bpm | undefined {
    if (!Number.isFinite(value) || value < MIN_BPM || value > MAX_BPM) {
        return undefined;
    }
    return value as Bpm;
}

/** The twelve pitch classes; the only valid roots for a musical key. */
export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type Pitch = (typeof PITCH_CLASSES)[number];

/** A key is either major or minor. */
export type KeyMode = 'major' | 'minor';

declare const keyBrand: unique symbol;
/**
 * A normalized musical-key label, e.g. `"C#"` (major) or `"C#m"` (minor).
 * Minor keys always carry a trailing `m`; major keys never do. Produced only by
 * {@link makeMusicalKey} so the `'C#m'` vs naked `'C#'` inconsistency the old
 * free-form string allowed cannot recur.
 */
export type MusicalKey = string & { readonly [keyBrand]: true };

function isPitch(value: string): value is Pitch {
    return (PITCH_CLASSES as readonly string[]).includes(value);
}

/** Build a canonical {@link MusicalKey} from a validated pitch and mode. */
export function makeMusicalKey(pitch: Pitch, mode: KeyMode): MusicalKey {
    return `${pitch}${mode === 'minor' ? 'm' : ''}` as MusicalKey;
}

/**
 * Parse a free-form key label (e.g. from the analyser or persisted data) into a
 * canonical {@link MusicalKey}, or `undefined` if the root pitch is not one of
 * the twelve pitch classes. A trailing `m` (any case) marks a minor key.
 */
export function parseMusicalKey(raw: string): MusicalKey | undefined {
    const trimmed = raw.trim();
    const minor = /m$/i.test(trimmed);
    const pitchPart = minor ? trimmed.slice(0, -1) : trimmed;
    const normalizedPitch = pitchPart.length > 0 ? pitchPart[0]!.toUpperCase() + pitchPart.slice(1) : '';
    if (!isPitch(normalizedPitch)) {
        return undefined;
    }
    return makeMusicalKey(normalizedPitch, minor ? 'minor' : 'major');
}

export type SampleAnalysis = {
    bpm?: Bpm;
    key?: MusicalKey;
    descriptors?: SpectralDescriptors;
};

export type SampleRecord = {
    id: string;
    libraryRootId: string;
    relativePath: string;
    /** Just the filename without extension */
    displayName: string;
    /** File extension */
    ext: string;
    /** Parent folder path within the library root */
    folder: string;

    sync: {
        exists: boolean;
        mtimeMs?: number;
        sizeBytes?: number;
        status: SampleSyncStatus;
    };

    format: {
        durationSec?: number;
        sampleRate?: number;
        channels?: number;
        bitDepth?: number;
    };

    /** G1: Intelligence metadata */
    analysis?: SampleAnalysis;

    /** G3: Map coordinates (normalized -1..1) */
    spatialMap?: {
        x: number;
        y: number;
    };

    /** G2: Timbral embedding availability */
    embeddingStatus?: 'pending' | 'ready' | 'error';

    tags: string[];
    favorite: boolean;
};

// ── Folder tree node ─────────────────────────────────────────────────────────

export type FolderNode = {
    name: string;
    path: string;
    children: FolderNode[];
    fileCount: number;
    expanded: boolean;
};

// ── Audio file extensions ────────────────────────────────────────────────────

export const AUDIO_EXTENSIONS = new Set([
    'wav',
    'wave',
    'mp3',
    'ogg',
    'flac',
    'aiff',
    'aif',
    'aac',
    'm4a',
    'webm',
    'opus',
]);

export function isAudioFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return AUDIO_EXTENSIONS.has(ext);
}

/**
 * Extensions that `AUDIO_EXTENSIONS` accepts for indexing but that the browser's
 * `AudioContext.decodeAudioData` frequently cannot decode (no native codec):
 * AIFF, FLAC, and AAC/M4A all depend on the platform's codec set and commonly
 * throw on decode in Chromium/Firefox. We still index these files (they are real
 * audio, and the desktop build can decode them natively), but the preview UI uses
 * this set to badge them as "may not preview" and to explain a failed decode
 * rather than swallowing it silently.
 */
export const BROWSER_DECODE_RISKY_EXTENSIONS = new Set(['aiff', 'aif', 'flac', 'aac', 'm4a']);

/** Whether the browser may be unable to decode this extension for preview. */
export function isBrowserDecodeRisky(ext: string): boolean {
    return BROWSER_DECODE_RISKY_EXTENSIONS.has(ext.toLowerCase());
}
