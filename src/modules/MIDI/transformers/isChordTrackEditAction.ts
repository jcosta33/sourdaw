import { type AppAction } from '#/utils/handlerContract';

export type ChordMutationAction = Exclude<
    Extract<AppAction, { type: `${string}Chord${string}` }>,
    { type: 'generateChordProgression' | 'restoreChordTrackState' }
>;

export function isChordTrackEditAction(action: AppAction): action is ChordMutationAction {
    return (
        action.type === 'addChordEvent' ||
        action.type === 'moveChordEvent' ||
        action.type === 'updateChordEvent' ||
        action.type === 'removeChordEvent' ||
        action.type === 'toggleChordTrack' ||
        action.type === 'clearChordTrack'
    );
}
