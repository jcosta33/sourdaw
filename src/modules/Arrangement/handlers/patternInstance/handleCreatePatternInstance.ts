import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type GeneratedMidiStateGuard } from '../../events/arrangementClipSnapshots';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { createPatternInstance } from '../../useCases/patternInstance/createPatternInstance';
import { prepareCreatedClipRedoGuard } from '../clip/prepareCreatedClipRedoGuard';
import { stampCreatedClipStateGuard } from '../clip/stampCreatedClipStateGuard';

import { isCreatePatternInstanceSessionEntry } from './isCreatePatternInstanceSessionEntry';

type CreateAction = Extract<AppAction, { type: 'createPatternInstance' }>;
type CreationState = {
    targetClipId: string;
    guard: GeneratedMidiStateGuard;
    stageRedoGuard?: (action: AppAction) => void;
};
const states = new WeakMap<CreateAction, CreationState>();

function getState(action: CreateAction): CreationState {
    const previous = states.get(action);
    if (previous) {
        return previous;
    }
    const targetClipId = action.payload.targetClipId ?? `clip-inst-${crypto.randomUUID()}`;
    action.payload.targetClipId = targetClipId;
    const state = { targetClipId, guard: { entityJson: '', midiByClipIdJson: '' } };
    states.set(action, state);
    return state;
}

function findSourceClip(sourceClipId: string) {
    return getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((clip) => clip.id === sourceClipId);
}

function clipExists(clipId: string): boolean {
    const state = getTrackStoreState();
    return (
        state?.ghostClips?.some((clip) => clip.id === clipId) === true ||
        state?.tracks.some(
            (track) =>
                track.clips.some((clip) => clip.id === clipId) ||
                track.alternatives.some((alternative) => alternative.clips.some((clip) => clip.id === clipId))
        ) === true
    );
}

/** The batch is a singleton, so the live stores are the state this action plans against. */
function findRefusal(action: CreateAction): string | null {
    const { sourceClipId, targetTrackId, startBeat, targetClipId } = action.payload;
    if (!Number.isFinite(startBeat) || startBeat < 0) {
        return 'The start beat must be a finite, non-negative beat';
    }
    if (targetClipId === '') {
        return 'The instance clip ID must not be empty';
    }
    const source = findSourceClip(sourceClipId);
    if (!source) {
        return `Clip "${sourceClipId}" does not exist`;
    }
    if (source.type !== 'midi') {
        return `Clip "${sourceClipId}" is not a MIDI clip, so it has no pattern to instance`;
    }
    const destination = getTrackStoreState()?.tracks.find((track) => track.id === targetTrackId);
    if (!destination) {
        return `Track "${targetTrackId}" does not exist`;
    }
    if (destination.kind !== 'midi') {
        return `Track "${targetTrackId}" is not a MIDI track, so it cannot host a pattern instance`;
    }
    if (destination.frozen === true) {
        return `Track "${targetTrackId}" is frozen`;
    }
    if (targetClipId !== undefined && clipExists(targetClipId)) {
        return `Clip "${targetClipId}" already exists`;
    }
    return null;
}

export const handleCreatePatternInstance = createHandler<'createPatternInstance'>({
    batchExecution: 'singleton',
    validate: (action) => findRefusal(action) === null,
    validationRefusalReason: findRefusal,
    validateSessionEntry: isCreatePatternInstanceSessionEntry,
    materializeCommandArguments: (action) => {
        getState(action);
    },
    execute: (alpha) => {
        const state = getState(alpha);
        const instanceId = createPatternInstance(
            alpha.payload.sourceClipId,
            alpha.payload.targetTrackId,
            alpha.payload.startBeat,
            state.targetClipId
        );
        if (instanceId === null) {
            return { status: 'no-write' };
        }
        stampCreatedClipStateGuard(state.guard, instanceId);
        if (state.stageRedoGuard) {
            state.stageRedoGuard(alpha);
            return {
                status: 'written',
                afterCommit: () => {
                    // Command settles the staged capture with its owning publication.
                },
                afterAmbiguousCommit: () => {
                    commitRedoInverseCapture({ phase: 'discard', actions: [alpha] });
                },
            };
        }
        return { status: 'written' };
    },
    undoable: true,
    describe: (action, context) => {
        const state = getState(action);
        if (!findSourceClip(action.payload.sourceClipId)) {
            return { label: 'Create Pattern Instance', inverseAction: null };
        }
        state.stageRedoGuard = prepareCreatedClipRedoGuard({
            recordedRedo: context?.recordedRedo,
            clipId: state.targetClipId,
            guard: state.guard,
        });
        return {
            label: 'Create Pattern Instance',
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: state.targetClipId, generatedMidiStateGuard: state.guard },
            },
        };
    },
});
