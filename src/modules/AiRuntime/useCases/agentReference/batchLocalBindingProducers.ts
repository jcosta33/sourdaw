import { type ProjectContext } from '../../models/ProjectContext';

export const BATCH_LOCAL_BINDING_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

/** Devices and their parameters are only identifiable inside an already-immutable owner. */
export const CAPABILITIES_REQUIRING_CONCRETE_DEPENDENCY: ReadonlySet<string> = new Set(['device', 'device-parameter']);

/** The catalog commands whose plan item may mint a batch-local `$binding`. */
export const BATCH_LOCAL_BINDING_PRODUCER_NAMES: ReadonlySet<string> = new Set(['createBus', 'addTrack', 'addClip']);

export type BatchLocalCreatedTrackKind = 'audio' | 'midi' | 'folder' | 'bus';

export type BatchLocalBindingProducer = {
    capabilities: readonly string[];
    /**
     * The producing `addClip` item's own track argument, kept so a consumer of the clip can
     * derive the owning track without a project snapshot that does not contain it yet.
     */
    parentTrackReference?: string;
    producerArgument: string;
    trackKind?: BatchLocalCreatedTrackKind;
};

export const BATCH_LOCAL_BUS_CAPABILITIES: readonly string[] = [
    'track',
    'armable-track',
    'duplicable-track',
    'removable-track',
    'routable-source',
    'bus',
    'output',
    'device-host-track',
];

const CREATED_TRACK_CAPABILITIES: readonly string[] = [
    'track',
    'armable-track',
    'duplicable-track',
    'removable-track',
    'device-host-track',
    'vca-member-track',
];

const CREATED_TRACK_PRODUCERS: Readonly<Record<string, BatchLocalBindingProducer>> = {
    audio: {
        capabilities: [...CREATED_TRACK_CAPABILITIES, 'routable-source'],
        producerArgument: 'id',
        trackKind: 'audio',
    },
    folder: { capabilities: CREATED_TRACK_CAPABILITIES, producerArgument: 'id', trackKind: 'folder' },
    midi: {
        capabilities: [...CREATED_TRACK_CAPABILITIES, 'routable-source'],
        producerArgument: 'id',
        trackKind: 'midi',
    },
};

function resolveCreatedTrackProducer(kind: unknown): BatchLocalBindingProducer | null {
    return typeof kind === 'string' ? (CREATED_TRACK_PRODUCERS[kind] ?? null) : null;
}

type CreatedClipParent = { frozen: boolean; kind: string };

function resolveCreatedClipParent(input: {
    context: ProjectContext;
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>;
    trackReference: string;
}): CreatedClipParent | null {
    if (input.trackReference.startsWith('$')) {
        const producer = input.producersByBinding.get(input.trackReference.slice(1));
        return producer?.trackKind === undefined ? null : { frozen: false, kind: producer.trackKind };
    }
    const track = input.context.tracks.find((candidate) => candidate.id === input.trackReference);
    return track === undefined ? null : { frozen: track.frozen === true, kind: track.kind };
}

/**
 * `addClip` derives the new clip's type from its track exactly as the arrangement handler does —
 * MIDI only under a MIDI track, audio everywhere else. A freshly created clip never carries notes,
 * so `editable-midi-clip`, which the canonical contract grants only to a clip that already has
 * some, is never granted here.
 */
function resolveCreatedClipCapabilities(parent: CreatedClipParent): readonly string[] | null {
    if (parent.kind === 'vca') {
        return null;
    }
    if (parent.kind !== 'midi') {
        return ['clip', 'editable-clip', 'editable-audio-clip'];
    }
    return parent.frozen ? ['clip', 'editable-clip'] : ['clip', 'editable-clip', 'writable-midi-clip'];
}

function resolveCreatedClipProducer(input: {
    arguments: Readonly<Record<string, unknown>>;
    context: ProjectContext;
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>;
}): BatchLocalBindingProducer | null {
    const trackReference = input.arguments.trackId;
    if (typeof trackReference !== 'string' || trackReference.length === 0) {
        return null;
    }
    const parent = resolveCreatedClipParent({
        context: input.context,
        producersByBinding: input.producersByBinding,
        trackReference,
    });
    const capabilities = parent === null ? null : resolveCreatedClipCapabilities(parent);
    if (capabilities === null) {
        return null;
    }
    return { capabilities, parentTrackReference: trackReference, producerArgument: 'id' };
}

/**
 * The one place that decides which catalog commands may mint a batch-local `$binding`, which
 * application-owned argument carries the minted identity, and which target capabilities the
 * created object may satisfy. The grants are static and mirror the canonical capability
 * contract for the kind of object the command creates, so they never depend on a snapshot
 * taken before the object exists.
 */
export function resolveBatchLocalBindingProducer(input: {
    arguments: Readonly<Record<string, unknown>>;
    context: ProjectContext;
    name: string;
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>;
}): BatchLocalBindingProducer | null {
    if (input.name === 'createBus') {
        return { capabilities: BATCH_LOCAL_BUS_CAPABILITIES, producerArgument: 'busId', trackKind: 'bus' };
    }
    if (input.name === 'addTrack') {
        return resolveCreatedTrackProducer(input.arguments.kind);
    }
    if (input.name === 'addClip') {
        return resolveCreatedClipProducer(input);
    }
    return null;
}
