/**
 * Core types for the local-first sample library.
 *
 * The user's filesystem is the source of truth. We store only references,
 * derived metadata, and user tags — never duplicate audio files.
 */

// ── File provider abstraction ────────────────────────────────────────────────

export type FileProviderKind = 'browser' | 'tauri';

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

export type LibraryRootStatus = 'ready' | 'offline' | 'permission_required' | 'scanning';

export type LibraryRoot = {
    id: string;
    name: string;
    provider: FileProviderKind;
    /** Browser: serialized FileSystemDirectoryHandle key; Tauri: absolute path */
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

export type SampleAnalysis = {
    bpm?: number;
    key?: string;
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
