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
        return {
            ...rest,
            ...(replacement.parentClipId.present ? { parentClipId: replacement.parentClipId.value } : {}),
            ...(replacement.overrides.present ? { overrides: structuredClone(replacement.overrides.value) } : {}),
        };
    });
    return written ? 'written' : 'conflict';
}
