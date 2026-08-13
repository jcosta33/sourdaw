import { type AppAction } from '#/utils/handlerContract';

const NONDETERMINISTIC_EXECUTABLE_OPERATIONS = new Set<AppAction['type']>([
    'duplicateClip',
    'duplicateClipToNextBar',
    'duplicateTrack',
    'glueClips',
    'splitClip',
]);

export function isVersionedCommandOperationSerializable(operation: AppAction['type']): boolean {
    return !NONDETERMINISTIC_EXECUTABLE_OPERATIONS.has(operation);
}
