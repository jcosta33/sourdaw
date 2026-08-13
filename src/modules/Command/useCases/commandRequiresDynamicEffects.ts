import { type AppAction } from '#/utils/handlerContract';

const DYNAMIC_EFFECT_OPERATIONS = new Set<AppAction['type']>([
    'clearSolos',
    'scaleAutomation',
    'stretchAutomation',
    'invertAutomation',
    'reverseAutomation',
    'thinAutomation',
    'quantizeAutomation',
    'duplicateClip',
    'duplicateClipToNextBar',
    'duplicateTrack',
    'removeTrack',
    'removeClip',
]);

export function commandRequiresDynamicEffects(operation: AppAction['type']): boolean {
    return DYNAMIC_EFFECT_OPERATIONS.has(operation);
}
