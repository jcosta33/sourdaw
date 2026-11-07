import { type AppAction } from '#/utils/handlerContract';

import { updateClipInStore } from '../../stores/updateClipInStore';

import { isPatternInstanceLinkCurrent } from './isPatternInstanceLinkCurrent';

type Input = Extract<AppAction, { type: 'restorePatternInstanceLink' }>['payload'];

export function restorePatternInstanceLink(input: Input): 'written' | 'conflict' {
    if (!isPatternInstanceLinkCurrent(input)) {
        return 'conflict';
    }
    const replacement = input.replacement;
    const written = updateClipInStore(input.clipId, (clip) => {
        const { parentClipId: _parent, overrides: _overrides, ...rest } = clip;
        const restored: typeof clip = rest;
        if (replacement.parentClipId.present) {
            restored.parentClipId = replacement.parentClipId.value;
        }
        if (replacement.overrides.present) {
            restored.overrides = structuredClone(replacement.overrides.value);
        }
        return restored;
    });
    return written ? 'written' : 'conflict';
}
