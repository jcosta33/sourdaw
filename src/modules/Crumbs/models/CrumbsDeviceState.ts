import { type CrumbsMode, type SampleCategory, type SampleMeta } from './CrumbsTypes';

/**
 * Wire version of the Crumbs device-state chunk. **Never renamed, never reused.**
 * Bump it only when the payload shape changes in a way an older reader would
 * misread; a reader that does not recognise the version falls back to the module
 * default rather than guessing at the fields.
 */
export const CRUMBS_DEVICE_STATE_VERSION = 1;

/**
 * JSON-shaped payload the document can store and merge. Mirrors the Arrangement
 * `DeviceStateValue` model structurally rather than importing it — models do not
 * cross module boundaries, and the chunk is opaque to the host by design.
 */
type CrumbsDeviceStateValue =
    string | number | boolean | null | CrumbsDeviceStateValue[] | { [key: string]: CrumbsDeviceStateValue };

type CrumbsDeviceStateChunk = {
    version: number;
    data: { [key: string]: CrumbsDeviceStateValue };
};

/**
 * The part of a Crumbs instance that decides *what it plays*.
 *
 * Its knobs are numbers and already ride `Device.parameterValues`, which is also
 * the automation surface. These two are not: the operating mode is a string, and
 * the sample is a file reference. Dropping them is what made a reopened project's
 * Crumbs tracks silent — `prepareCrumbsEngine` reads the sample path from here and
 * had nothing to read.
 *
 * Pads and slices are deliberately **not** in the chunk. They reach the engine as
 * nothing today (`CrumbsEngine::note_on` hardcodes `start_frame: 0` and
 * `choke_group: 0`), so persisting them would write state no render can consume and
 * would pin a format for a model that is about to change when they are wired up.
 */
export type CrumbsDevicePlayback = {
    mode: CrumbsMode;
    activeSample: SampleMeta | null;
};

type ToCrumbsDeviceStateInput = CrumbsDevicePlayback;

/** Serialise a live instance's playback state into the chunk the document stores. */
export function toCrumbsDeviceState({ mode, activeSample }: ToCrumbsDeviceStateInput): CrumbsDeviceStateChunk {
    return {
        version: CRUMBS_DEVICE_STATE_VERSION,
        // Structured, not stringified: the document merges the subtree field by
        // field, so a peer switching mode does not clobber a peer loading a sample.
        data: {
            mode,
            activeSample: activeSample
                ? {
                      sampleId: activeSample.sampleId,
                      sampleRate: activeSample.sampleRate,
                      channels: activeSample.channels,
                      frameCount: activeSample.frameCount,
                      durationSecs: activeSample.durationSecs,
                      detectedRoot: activeSample.detectedRoot,
                      detectedBpm: activeSample.detectedBpm,
                      category: activeSample.category,
                      filePath: activeSample.filePath,
                      fileName: activeSample.fileName,
                  }
                : null,
        },
    };
}

const CRUMBS_MODES: readonly CrumbsMode[] = ['quick', 'drum', 'slice', 'warp', 'record'];
const SAMPLE_CATEGORIES: readonly SampleCategory[] = ['percussive', 'tonal', 'loop', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function readNullableNumber(value: unknown): number | null {
    return isFiniteNumber(value) ? value : null;
}

function readSampleMeta(value: unknown): SampleMeta | null {
    if (!isRecord(value)) {
        return null;
    }
    // `filePath` is the only field the engine cannot do without: it is what
    // `prepareCrumbsEngine` decodes. A chunk missing it describes a sample nobody
    // can reload, so it is dropped rather than restored as a broken reference.
    if (typeof value.filePath !== 'string' || value.filePath.length === 0) {
        return null;
    }
    if (
        !isFiniteNumber(value.sampleId) ||
        !isFiniteNumber(value.sampleRate) ||
        !isFiniteNumber(value.channels) ||
        !isFiniteNumber(value.frameCount) ||
        !isFiniteNumber(value.durationSecs)
    ) {
        return null;
    }
    const category = SAMPLE_CATEGORIES.find((known) => known === value.category);
    return {
        sampleId: value.sampleId,
        sampleRate: value.sampleRate,
        channels: value.channels,
        frameCount: value.frameCount,
        durationSecs: value.durationSecs,
        detectedRoot: readNullableNumber(value.detectedRoot),
        detectedBpm: readNullableNumber(value.detectedBpm),
        category: category ?? 'unknown',
        filePath: value.filePath,
        fileName: typeof value.fileName === 'string' ? value.fileName : value.filePath,
    };
}

/**
 * Read playback state back out of a device-state chunk, or `null` when the chunk
 * holds none this build can use.
 *
 * `null` rather than a repaired default so the caller can tell "this device has
 * never been configured" from "this build cannot read the chunk" — the two lead to
 * the same silence, but only one of them is a bug worth seeing.
 */
export function fromCrumbsDeviceState(chunk: unknown): CrumbsDevicePlayback | null {
    if (!isRecord(chunk) || chunk.version !== CRUMBS_DEVICE_STATE_VERSION || !isRecord(chunk.data)) {
        return null;
    }

    const data = chunk.data;
    const mode = CRUMBS_MODES.find((known) => known === data.mode);
    const activeSample = readSampleMeta(data.activeSample);
    if (!mode && !activeSample) {
        return null;
    }

    return {
        // An unreadable mode with a readable sample still restores the sample: the
        // sample is the part that decides whether the track makes a sound at all.
        mode: mode ?? 'quick',
        activeSample,
    };
}
