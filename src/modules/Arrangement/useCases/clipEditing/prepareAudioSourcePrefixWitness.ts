import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import {
    captureTempoSourceOwnerValue,
    getTempoAudioSourceRequirements,
    projectTempoSourceClock,
    tempoMapStore,
    tempoSourceOwnerWitnessMatches,
    transportStore,
    type TempoScalarTransition,
    type TempoSourceClock,
    type TempoSourceOwnerWitness,
} from '#/modules/Transport/stores';
import { type AppAction, type HandlerCommitValidation, type HandlerValidationContext } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { projectAudioSourcePrefixTracks } from '../../stores/projectAudioSourcePrefixTracks';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { type projectTempoAudioSources } from '../../stores/tempoAudioSources';
import { type TempoAudioSourceWriteClock } from '../../stores/tempoAudioSourceWriteIntent';
import { getTrackStoreState } from '../getTrackStoreState';

import { addActionSourceOwners } from './addActionSourceOwners';
import { addPromotionOwners } from './addPromotionOwners';
import { type OwnerFields } from './addSourceOwner';
import { projectClipReplayPrefix } from './projectClipReplayPrefix';
import { readTempoScalarTransition } from './readTempoScalarTransition';

type Input = {
    readonly promotion: Extract<AppAction, { type: 'restoreTempoEdit' }>['payload']['audioSourcePromotion'];
    readonly direction: 'promote' | 'restore';
    readonly context?: Pick<HandlerValidationContext, 'actions' | 'actionIndex'>;
} & TempoAudioSourceWriteClock;
type State = NonNullable<ReturnType<typeof projectClipReplayPrefix>>;
type SourceState = Pick<State, 'tracks' | 'takeLanes'>;

function sourceContext(state: SourceState) {
    return { tracks: { tracks: state.tracks }, takeLanes: { lanes: state.takeLanes } };
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
        const transition = readTempoScalarTransition(action);
        if (transition === undefined) {
            continue;
        }
        if (transition === null) {
            return null;
        }
        reverse.push(transition);
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
        addActionSourceOwners(owners, action, state, next);
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
