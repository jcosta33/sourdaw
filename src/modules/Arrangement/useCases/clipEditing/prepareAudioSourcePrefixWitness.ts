import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { type AppAction, type HandlerCommitValidation, type HandlerValidationContext } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { getTempoAudioSourceRequirements } from '#/utils/tempoAudioSourceCoverage';
import {
    captureTempoSourceOwnerValue,
    projectTempoSourceClock,
    tempoSourceOwnerWitnessMatches,
    type TempoScalarTransition,
    type TempoSourceClock,
    type TempoSourceOwner,
    type TempoSourceOwnerWitness,
} from '#/utils/tempoAudioSourcePromotion';

import { projectAudioSourcePrefixTracks } from '../../stores/projectAudioSourcePrefixTracks';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { type projectTempoAudioSources } from '../../stores/tempoAudioSources';
import { type TempoAudioSourceWriteClock } from '../../stores/tempoAudioSourceWriteIntent';
import { getTrackStoreState } from '../getTrackStoreState';

import { preparedClipSplits } from './preparedClipSplit';
import { projectClipReplayPrefix } from './projectClipReplayPrefix';

type Input = {
    readonly promotion: Extract<AppAction, { type: 'restoreTempoEdit' }>['payload']['audioSourcePromotion'];
    readonly direction: 'promote' | 'restore';
    readonly context?: Pick<HandlerValidationContext, 'actions' | 'actionIndex'>;
} & TempoAudioSourceWriteClock;
type State = NonNullable<ReturnType<typeof projectClipReplayPrefix>>;
type SourceState = Pick<State, 'tracks' | 'takeLanes'>;
type OwnerFields = { owner: TempoSourceOwner; fields: Set<string> };

const CLIP_SOURCE_FIELDS = [
    'id',
    'trackId',
    'type',
    'startBeat',
    'endBeat',
    'audioBufferId',
    'fileId',
    'assetHash',
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
    'stretchMode',
    'stretchRatio',
];
const TAKE_SOURCE_FIELDS = [
    'id',
    'clipId',
    'startBeat',
    'endBeat',
    'sourceOffsetBeats',
    'sourceOffsetSeconds',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
    'passOriginBeat',
    'passOriginSourceSeconds',
];

function addOwner(owners: Map<string, OwnerFields>, owner: TempoSourceOwner, fields: readonly string[]): void {
    const key = JSON.stringify(owner);
    const existing = owners.get(key);
    const ownerFields = new Set(existing?.fields);
    for (const field of fields) {
        ownerFields.add(field);
    }
    owners.set(key, { owner, fields: ownerFields });
}

function sourceContext(state: SourceState) {
    return { tracks: { tracks: state.tracks }, takeLanes: { lanes: state.takeLanes } };
}

function addSplitGapOwners(
    owners: Map<string, OwnerFields>,
    trackId: string,
    laneId: string,
    oldLane: State['takeLanes'][number] | undefined,
    nextLane: State['takeLanes'][number] | undefined
): void {
    const gaps = (oldLane?.baseGapAudioSources ?? []).concat(nextLane?.baseGapAudioSources ?? []);
    for (const gap of gaps) {
        const matches = (row: typeof gap) =>
            row.clipId === gap.clipId && row.startBeat === gap.startBeat && row.endBeat === gap.endBeat;
        if (
            !valuesEqual(
                oldLane?.baseGapAudioSources?.find(matches) ?? null,
                nextLane?.baseGapAudioSources?.find(matches) ?? null
            )
        ) {
            addOwner(
                owners,
                {
                    kind: 'gap',
                    trackId,
                    laneId,
                    clipId: gap.clipId,
                    startBeat: gap.startBeat,
                    endBeat: gap.endBeat,
                },
                ['clipId', 'startBeat', 'endBeat', 'audioSource']
            );
        }
    }
}

function addSplitRegionAndGapOwners(
    owners: Map<string, OwnerFields>,
    trackId: string,
    laneId: string,
    oldLane: State['takeLanes'][number] | undefined,
    nextLane: State['takeLanes'][number] | undefined
): void {
    const regions = (oldLane?.activeCompRegions ?? []).concat(nextLane?.activeCompRegions ?? []);
    for (const region of regions) {
        const matches = (row: typeof region) =>
            row.takeId === region.takeId && row.startBeat === region.startBeat && row.endBeat === region.endBeat;
        if (
            !valuesEqual(
                oldLane?.activeCompRegions.find(matches) ?? null,
                nextLane?.activeCompRegions.find(matches) ?? null
            )
        ) {
            addOwner(
                owners,
                {
                    kind: 'region',
                    trackId,
                    laneId,
                    takeId: region.takeId,
                    startBeat: region.startBeat,
                    endBeat: region.endBeat,
                },
                ['takeId', 'startBeat', 'endBeat', 'audioSource']
            );
        }
    }
    addSplitGapOwners(owners, trackId, laneId, oldLane, nextLane);
}

function addSplitLaneOwners(
    owners: Map<string, OwnerFields>,
    trackId: string,
    laneId: string,
    before: State,
    after: State
): void {
    const oldLane = before.takeLanes.find((lane) => lane.id === laneId);
    const nextLane = after.takeLanes.find((lane) => lane.id === laneId);
    const takes = new Map((oldLane?.takes ?? []).concat(nextLane?.takes ?? []).map((take) => [take.id, take]));
    for (const take of takes.values()) {
        const old = oldLane?.takes.find((row) => row.id === take.id);
        const next = nextLane?.takes.find((row) => row.id === take.id);
        if (!valuesEqual(old ? { ...old, selected: false } : null, next ? { ...next, selected: false } : null)) {
            addOwner(owners, { kind: 'take', trackId, laneId, takeId: take.id }, TAKE_SOURCE_FIELDS);
        }
    }
    addSplitRegionAndGapOwners(owners, trackId, laneId, oldLane, nextLane);
}

function addSplitOwners(owners: Map<string, OwnerFields>, action: AppAction, before: State, after: State): void {
    let pair: Pick<NonNullable<ReturnType<typeof preparedClipSplits.get>>, 'previous' | 'next'> | null = null;
    if (action.type === 'splitClip') {
        pair = preparedClipSplits.get(action) ?? null;
    } else if (action.type === 'restoreClipSplitState') {
        pair = { previous: action.payload.expected, next: action.payload.replacement };
    }
    if (!pair || pair.previous.leftClip.type !== 'audio') {
        return;
    }
    const track = before.tracks?.find((row) => row.id === pair.previous.trackId);
    if (!track) {
        return;
    }
    const clipIds = [pair.previous.leftClip.id, pair.next.rightClip?.id ?? pair.previous.rightClip?.id];
    for (const clipId of clipIds) {
        if (clipId) {
            addOwner(
                owners,
                {
                    kind: 'clip',
                    trackId: track.id,
                    collection: 'active',
                    alternativeId: track.activeAlternativeId,
                    clipId,
                },
                CLIP_SOURCE_FIELDS
            );
        }
    }
    const laneIds = new Set(
        [...before.takeLanes, ...after.takeLanes].filter((lane) => lane.trackId === track.id).map((lane) => lane.id)
    );
    for (const laneId of laneIds) {
        addSplitLaneOwners(owners, track.id, laneId, before, after);
    }
}

function addTempoOwners(owners: Map<string, OwnerFields>, action: AppAction): void {
    if (action.type !== 'setTempo' && action.type !== 'restoreTempoEdit') {
        return;
    }
    if (action.type === 'setTempo' && action.payload.bpm === action.payload.expectedBpm) {
        return;
    }
    const plan = action.payload.audioSourcePromotion;
    if (!plan) {
        return;
    }
    addPromotionOwners(owners, plan);
}

function addPromotionOwners(owners: Map<string, OwnerFields>, plan: Input['promotion']): void {
    for (const clip of plan.clips) {
        addOwner(
            owners,
            {
                kind: 'clip',
                trackId: clip.trackId,
                collection: clip.collection,
                alternativeId: clip.alternativeId,
                clipId: clip.clipId,
            },
            CLIP_SOURCE_FIELDS
        );
    }
    for (const take of plan.takes) {
        addOwner(
            owners,
            {
                kind: 'take',
                trackId: take.trackId,
                laneId: take.laneId,
                takeId: take.takeId,
            },
            TAKE_SOURCE_FIELDS
        );
    }
    for (const region of plan.regions) {
        addOwner(
            owners,
            {
                kind: 'region',
                trackId: region.trackId,
                laneId: region.laneId,
                takeId: region.takeId,
                startBeat: region.startBeat,
                endBeat: region.endBeat,
            },
            ['takeId', 'startBeat', 'endBeat', 'audioSource']
        );
    }
    for (const gap of plan.gaps) {
        addOwner(
            owners,
            {
                kind: 'gap',
                trackId: gap.trackId,
                laneId: gap.laneId,
                clipId: gap.clipId,
                startBeat: gap.startBeat,
                endBeat: gap.endBeat,
            },
            ['clipId', 'startBeat', 'endBeat', 'audioSource']
        );
    }
}

function initialClock(input: Input): TempoSourceClock | null {
    const transport = transportStore.value;
    if (!transport) {
        return null;
    }
    const actual = structuredClone({ tempo: transport.tempo, changes: tempoMapStore.value?.changes ?? [] });
    const reverse: TempoScalarTransition[] = [];
    const priorActions = input.context?.actions.slice(0, input.context.actionIndex) ?? [];
    for (const action of priorActions.reverse()) {
        if (action.type !== 'setTempo' && action.type !== 'restoreTempoEdit') {
            continue;
        }
        const { bpm, expectedBpm, tempoChangeId } = action.payload;
        if (tempoChangeId === undefined || expectedBpm === undefined) {
            return null;
        }
        reverse.push({ tempoChangeId, expectedBpm: bpm, bpm: expectedBpm });
    }
    return projectTempoSourceClock(actual, reverse);
}

function captureRowWitness(
    input: Input,
    projected: NonNullable<ReturnType<typeof projectTempoAudioSources>>,
    document: Readonly<Record<string, unknown>>
) {
    // Row commands are singletons until they have an owned prefix contract.
    // These values come from the same admitted source producer, never JSON.
    if (input.context && (input.context.actions.length !== 1 || input.context.actionIndex !== 0)) {
        return null;
    }
    const owners = new Map<string, OwnerFields>();
    addPromotionOwners(owners, input.promotion);
    const witness = captureWitness(
        document,
        owners,
        { tracks: getTrackStoreState()?.tracks ?? [], takeLanes: takeLaneStore.value?.lanes ?? [] },
        { tracks: projected.tracks, takeLanes: projected.lanes }
    );
    if (witness && !tempoSourceOwnerWitnessMatches(document, witness.ownerWitness, 'read')) {
        witness.commitValidation.release();
        return null;
    }
    return witness;
}

/** Current raw source owners, the actual prepared prefix and its final value.
 * Only their bounded source facets survive this function; no root snapshot,
 * callback or history authority enters adapter metadata. */
export function prepareAudioSourcePrefixWitness(
    input: Input,
    projected: NonNullable<ReturnType<typeof projectTempoAudioSources>>
): {
    readonly ownerWitness: TempoSourceOwnerWitness;
    readonly commitValidation: HandlerCommitValidation;
} | null {
    const document = getCrdtDoc('root');
    if (!document || !getTempoAudioSourceRequirements(document)) {
        return null;
    }
    if ('rowClock' in input) {
        return captureRowWitness(input, projected, document);
    }
    const clock = initialClock(input);
    if (!clock) {
        return null;
    }
    const rawTracks: unknown = document.tracks ?? { tracks: [] };
    const rawLanes: unknown = document.takeLanes ?? { lanes: [] };
    if (!isRecord(rawLanes) || !Array.isArray(rawLanes.lanes)) {
        return null;
    }
    const takeLanes = decodeExactTakeLaneSnapshots(rawLanes.lanes, 'source-prefix');
    if (!takeLanes) {
        return null;
    }
    const current: AppAction = {
        type: 'restoreTempoEdit',
        payload: {
            ...input.target,
            sourceDirection: input.direction,
            audioSourcePromotion: input.promotion,
        },
    };
    const index = input.context?.actionIndex ?? 0;
    let actions: readonly AppAction[];
    if (input.context) {
        actions = [...input.context.actions.slice(0, index), current, ...input.context.actions.slice(index + 1)];
    } else {
        actions = [current];
    }
    let state = projectClipReplayPrefix([], {
        tracks: projectAudioSourcePrefixTracks(rawTracks),
        takeLanes,
        automationLanes: [],
        clock,
    });
    if (!state?.tracks) {
        return null;
    }
    const owners = new Map<string, OwnerFields>();
    let read = state;
    for (const [actionIndex, action] of actions.entries()) {
        if (!state.tracks) {
            return null;
        }
        if (actionIndex === index) {
            read = state;
        }
        const next = projectClipReplayPrefix([action], {
            tracks: state.tracks,
            takeLanes: state.takeLanes,
            automationLanes: state.lanes,
            clock: state.clock,
        });
        if (!next?.tracks) {
            return null;
        }
        addTempoOwners(owners, action);
        addSplitOwners(owners, action, state, next);
        state = next;
    }
    return captureWitness(document, owners, read, state);
}

function captureWitness(
    document: Readonly<Record<string, unknown>>,
    owners: ReadonlyMap<string, OwnerFields>,
    read: SourceState,
    state: SourceState
): {
    readonly ownerWitness: TempoSourceOwnerWitness;
    readonly commitValidation: HandlerCommitValidation;
} | null {
    const rows: TempoSourceOwnerWitness['rows'][number][] = [];
    for (const { owner, fields } of owners.values()) {
        const keys = [...fields];
        const before = captureTempoSourceOwnerValue(document, owner, keys);
        const atRead = captureTempoSourceOwnerValue(sourceContext(read), owner, keys);
        const after = captureTempoSourceOwnerValue(sourceContext(state), owner, keys);
        if (!before || !atRead || !after) {
            return null;
        }
        rows.push({ owner, fields: keys, before, read: atRead, after });
    }
    const ownerWitness: TempoSourceOwnerWitness = { rows };
    if (
        !tempoSourceOwnerWitnessMatches(
            { tracks: getTrackStoreState(), takeLanes: takeLaneStore.value },
            ownerWitness,
            'read'
        )
    ) {
        return null;
    }
    const commitValidation: HandlerCommitValidation = {
        documentId: 'root',
        beforeCommit: () => {
            const currentDocument = getCrdtDoc('root');
            return currentDocument &&
                getTempoAudioSourceRequirements(currentDocument) &&
                tempoSourceOwnerWitnessMatches(currentDocument, ownerWitness, 'before')
                ? null
                : 'Audio source prefix owner changed before commit';
        },
        validateDocument: (prospective) =>
            tempoSourceOwnerWitnessMatches(prospective, ownerWitness, 'after')
                ? null
                : 'Audio source prefix did not publish its prepared owners',
        release: () => undefined,
    };
    return { ownerWitness, commitValidation };
}
