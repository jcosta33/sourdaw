import { type ProjectContext, type ProjectContextDeviceParameter } from '../../models/ProjectContext';

export const BATCH_LOCAL_BINDING_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

/** Devices and their parameters are only identifiable inside an already-immutable owner. */
export const CAPABILITIES_REQUIRING_CONCRETE_DEPENDENCY: ReadonlySet<string> = new Set(['device', 'device-parameter']);

const BATCH_LOCAL_BINDING_PRODUCER_NAME_LIST = ['createBus', 'addTrack', 'addClip', 'addDevice'] as const;

export type BatchLocalBindingProducerName = (typeof BATCH_LOCAL_BINDING_PRODUCER_NAME_LIST)[number];

/** The catalog commands whose plan item may mint a batch-local `$binding`. */
export const BATCH_LOCAL_BINDING_PRODUCER_NAMES: ReadonlySet<string> = new Set(BATCH_LOCAL_BINDING_PRODUCER_NAME_LIST);

/**
 * The only commands the plan-created object route may admit. Membership is about what a command
 * changes, not what it targets: every effect of these lands inside the object being created.
 * A command that merely accepts a batch-local target can still reach the rest of the project
 * through it — soloing a created track silences every other track, live and on export — so target
 * identity is not a safe admission test, and this set is stated explicitly rather than derived.
 */
export const PLAN_CREATED_OBJECT_COMMANDS: ReadonlySet<string> = new Set([
    'addTrack',
    'addClip',
    'addDevice',
    'createBus',
    'addNotes',
    'setDeviceParameter',
] as const);

/**
 * What the creation budget counts: commands that leave one more track or clip in the project than
 * it held before, whether by minting one, copying one, or dividing one. The budget bounds how much
 * a single accepted proposal can put in front of a musician to review and undo, and by that measure
 * a copy and a split cost exactly what a fresh creation costs.
 *
 * Two creating commands are deliberately outside it. `importStemSet` answers to its own asset
 * budget, which bounds the same work in the unit that actually constrains it. `createVcaGroup`
 * groups tracks that already exist and leaves no new track or clip behind.
 */
export const PROJECT_OBJECT_CREATING_COMMANDS: ReadonlySet<string> = new Set([
    'createBus',
    'addTrack',
    'addClip',
    'duplicateTrack',
    'duplicateClip',
    'duplicateClipToNextBar',
    'createDrumPreviewBranches',
    'splitClip',
]);

export type BatchLocalCreatedTrackKind = 'audio' | 'midi' | 'folder' | 'bus';

export type BatchLocalBindingProducer = {
    /** The canonical descriptor identity for an `addDevice` producer. */
    createdDeviceType?: string;
    /** The canonical display name for an `addDevice` producer. */
    createdDeviceName?: string;
    /** Exact descriptor-backed defaults and write contract for the created device. */
    createdDeviceParameters?: readonly ProjectContextDeviceParameter[];
    capabilities: readonly string[];
    /**
     * The producing `addClip` item's own track argument, kept so a consumer of the clip can
     * derive the owning track without a project snapshot that does not contain it yet.
     */
    parentTrackReference?: string;
    /** The exact device-chain anchor declared by an `addDevice` producer. */
    afterDeviceReference?: string;
    /**
     * The span the producing `addClip` item declared, in beats, kept so a later item writing into
     * the clip can be bounded by it. The clip does not exist in any snapshot yet, so this record is
     * the only place its dimensions are stated.
     */
    createdClipSpanBeats?: number;
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

/**
 * A freshly created clip carries no notes, so `editable-midi-clip` — which the canonical contract
 * grants only to a clip that already has some — is never among these grants.
 */
export const BATCH_LOCAL_CLIP_CAPABILITIES: readonly string[] = ['clip', 'editable-clip', 'writable-midi-clip'];

const CREATED_TRACK_CAPABILITIES: readonly string[] = [
    'track',
    'armable-track',
    'duplicable-track',
    'removable-track',
    'device-host-track',
    'vca-member-track',
];

const BATCH_LOCAL_DEVICE_CAPABILITIES: readonly string[] = ['device'];

/**
 * Keyed by the `kind` an `addTrack` plan item may declare; any other kind creates no bindable track.
 * A map rather than a record because the key is provider-controlled, and an object index would
 * answer an inherited `Object.prototype` name with a value that is not a producer.
 */
export const BATCH_LOCAL_TRACK_PRODUCERS_BY_KIND: ReadonlyMap<string, BatchLocalBindingProducer> = new Map([
    [
        'audio',
        {
            capabilities: [...CREATED_TRACK_CAPABILITIES, 'routable-source'],
            producerArgument: 'id',
            trackKind: 'audio',
        },
    ],
    ['folder', { capabilities: CREATED_TRACK_CAPABILITIES, producerArgument: 'id', trackKind: 'folder' }],
    [
        'midi',
        { capabilities: [...CREATED_TRACK_CAPABILITIES, 'routable-source'], producerArgument: 'id', trackKind: 'midi' },
    ],
]);

function resolveCreatedTrackProducer(kind: unknown): BatchLocalBindingProducer | null {
    return typeof kind === 'string' ? (BATCH_LOCAL_TRACK_PRODUCERS_BY_KIND.get(kind) ?? null) : null;
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
 * The provider-facing `addClip` creates one empty MIDI clip on an unfrozen MIDI track, and the
 * bridge refuses every other destination, so no other parent yields a clip a later plan item could
 * bind to.
 */
function acceptsCreatedClip(parent: CreatedClipParent | null): boolean {
    return parent !== null && parent.kind === 'midi' && !parent.frozen;
}

/** The declared span, or nothing when the item did not state a usable one. */
function resolveDeclaredClipSpan(argumentsRecord: Readonly<Record<string, unknown>>): number | undefined {
    const { startBeat, endBeat } = argumentsRecord;
    if (typeof startBeat !== 'number' || typeof endBeat !== 'number') {
        return undefined;
    }
    const span = endBeat - startBeat;
    return Number.isFinite(span) && span > 0 ? span : undefined;
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
    if (!acceptsCreatedClip(parent)) {
        return null;
    }
    return {
        capabilities: BATCH_LOCAL_CLIP_CAPABILITIES,
        createdClipSpanBeats: resolveDeclaredClipSpan(input.arguments),
        parentTrackReference: trackReference,
        producerArgument: 'id',
    };
}

function findAvailableDeviceType(context: ProjectContext, assertedType: unknown) {
    if (typeof assertedType !== 'string') {
        return undefined;
    }
    const normalized = assertedType.toLocaleLowerCase();
    const matches = (context.availableDeviceTypes ?? []).filter(
        (deviceType) =>
            deviceType.id.toLocaleLowerCase() === normalized || deviceType.name.toLocaleLowerCase() === normalized
    );
    return matches.length === 1 ? matches[0] : undefined;
}

function isCompatibleDeviceHostReference(
    context: ProjectContext,
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>,
    trackReference: string
): boolean {
    if (trackReference.startsWith('$')) {
        return producersByBinding.get(trackReference.slice(1))?.capabilities.includes('device-host-track') ?? false;
    }
    const track = context.tracks.find((candidate) => candidate.id === trackReference);
    return track !== undefined && track.kind !== 'vca' && track.frozen !== true;
}

function isCompatibleDeviceAnchor(input: {
    afterDeviceReference: unknown;
    context: ProjectContext;
    parentTrackReference: string;
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>;
}): boolean {
    if (input.afterDeviceReference === undefined) {
        return true;
    }
    if (typeof input.afterDeviceReference !== 'string' || input.afterDeviceReference.length === 0) {
        return false;
    }
    if (input.afterDeviceReference.startsWith('$')) {
        const anchor = input.producersByBinding.get(input.afterDeviceReference.slice(1));
        return anchor?.createdDeviceType !== undefined && anchor.parentTrackReference === input.parentTrackReference;
    }
    if (input.parentTrackReference.startsWith('$')) {
        return false;
    }
    return (
        input.context.tracks
            .find((track) => track.id === input.parentTrackReference)
            ?.devices.some((device) => device.id === input.afterDeviceReference) ?? false
    );
}

function resolveCreatedDeviceProducer(input: {
    arguments: Readonly<Record<string, unknown>>;
    context: ProjectContext;
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>;
}): BatchLocalBindingProducer | null {
    const trackReference = input.arguments.trackId;
    if (
        typeof trackReference !== 'string' ||
        trackReference.length === 0 ||
        !isCompatibleDeviceHostReference(input.context, input.producersByBinding, trackReference)
    ) {
        return null;
    }
    const descriptor = findAvailableDeviceType(input.context, input.arguments.deviceType);
    if (descriptor === undefined || descriptor.parameters === undefined) {
        return null;
    }
    if (
        !isCompatibleDeviceAnchor({
            afterDeviceReference: input.arguments.afterDeviceId,
            context: input.context,
            parentTrackReference: trackReference,
            producersByBinding: input.producersByBinding,
        })
    ) {
        return null;
    }
    return {
        capabilities: BATCH_LOCAL_DEVICE_CAPABILITIES,
        createdDeviceName: descriptor.name,
        createdDeviceParameters: descriptor.parameters.map((parameter) => ({ ...parameter })),
        createdDeviceType: descriptor.id,
        ...(typeof input.arguments.afterDeviceId === 'string'
            ? { afterDeviceReference: input.arguments.afterDeviceId }
            : {}),
        parentTrackReference: trackReference,
        producerArgument: 'deviceId',
    };
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
    if (input.name === 'addDevice') {
        return resolveCreatedDeviceProducer(input);
    }
    return null;
}
