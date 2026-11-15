import { describe, expect, it } from 'vitest';

import { getAppActionExecutionPolicy } from '#/modules/Command/useCases';

import { PRESET_ACTIONS, type PresetContext } from '../Registry';

const contexts: readonly PresetContext[] = [
    {
        selectedTrackId: undefined,
        selectedClipId: undefined,
        selectedClipType: undefined,
        trackCount: 0,
    },
    {
        selectedTrackId: 'track-1',
        selectedClipId: undefined,
        selectedClipType: undefined,
        trackCount: 2,
    },
    {
        selectedTrackId: 'track-1',
        selectedClipId: 'clip-midi',
        selectedClipType: 'midi',
        trackCount: 2,
    },
    {
        selectedTrackId: 'track-1',
        selectedClipId: 'clip-audio',
        selectedClipType: 'audio',
        trackCount: 2,
    },
];

describe('preset action execution policy', () => {
    it('explicitly classifies every action produced by the preset registry', () => {
        const actionTypes = new Set<string>();

        for (const preset of PRESET_ACTIONS) {
            for (const context of contexts) {
                const result = preset.buildAction(context);
                const actions = Array.isArray(result) ? result : [result];
                for (const action of actions) {
                    if (action !== null) {
                        actionTypes.add(action.type);
                    }
                }
            }
        }

        const unclassifiedActionTypes = [...actionTypes]
            .filter((actionType) => getAppActionExecutionPolicy(actionType).classification !== 'explicit')
            .sort();
        expect(unclassifiedActionTypes).toEqual([]);
    });
});
