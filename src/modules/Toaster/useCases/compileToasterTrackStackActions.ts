import { compileLoadPresetActions } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { DEFAULT_PAD_NAMES, PAD_COLORS } from '../models/ToasterKit';

type ToasterTrackStackPlan = Readonly<{
    actions: readonly AppAction[];
    deviceIds: readonly string[];
    groupLabel: string;
    trackId: string;
}>;

function nextId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Compiles the Toaster's parent and sixteen routed pad tracks into one
 * Arrangement action batch. Device identity/type materialization remains in
 * Arrangement's preset catalog; this module contributes only Toaster-owned pad
 * presentation metadata.
 */
export function compileToasterTrackStackActions(): ToasterTrackStackPlan | null {
    const plan = compileLoadPresetActions({ presetId: 'toaster-default' });
    const [parentAction, loadPresetAction] = plan?.actions ?? [];
    if (!plan || parentAction?.type !== 'addTrack' || loadPresetAction?.type !== 'loadPreset') {
        return null;
    }

    const padActions: AppAction[] = DEFAULT_PAD_NAMES.map((name, index) => ({
        type: 'addTrack',
        payload: {
            id: nextId('toaster-pad-track'),
            initialAlternativeId: nextId('toaster-pad-alternative'),
            name,
            kind: 'midi',
            parentId: plan.trackId,
            outputId: plan.trackId,
            withoutDefaultDevice: true,
            color: PAD_COLORS[index] ?? '#000000',
            select: false,
        },
    }));

    return {
        ...plan,
        actions: [
            {
                ...parentAction,
                payload: { ...parentAction.payload, select: true },
            },
            loadPresetAction,
            ...padActions,
        ],
        groupLabel: 'Create Toaster Kit',
    };
}
