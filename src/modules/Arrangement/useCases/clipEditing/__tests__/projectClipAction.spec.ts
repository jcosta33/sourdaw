import { isDeepStrictEqual } from 'node:util';

import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { changesTempoByActionType } from '../../../models/ChangesTempoByActionType';
import { projectClipAction } from '../projectClipAction';
import { projectClipReplayPrefix } from '../projectClipReplayPrefix';

const allActionTypes = Object.keys(changesTempoByActionType);

// The entries that move, drop or restore clip geometry; every other action type is keepState.
const shiftingActionTypes = [
    'discardDuplicatedClip',
    'duplicateClipAt',
    'removeClip',
    'restoreClip',
    'restoreClipSplitState',
    'restoreTempoEdit',
    'setTempo',
    'splitClip',
];

const start = projectClipReplayPrefix([], {
    tracks: [
        TrackDummy.create({
            id: 'track',
            clips: [
                ClipDummy.create({ id: 'a', trackId: 'track', startBeat: 0, endBeat: 4 }),
                ClipDummy.create({ id: 'b', trackId: 'track', startBeat: 4, endBeat: 8 }),
            ],
        }),
    ],
    takeLanes: [],
    automationLanes: [],
    clock: { tempo: 120, changes: [] },
});

function emptyPayloadAction(type: string): AppAction {
    // Payloads differ per arm of the union; the wire form is untyped, so JSON.parse needs no cast.
    return JSON.parse(`{"type":"${type}","payload":{}}`);
}

function projectsAsKeepState(type: string): boolean {
    if (!start) {
        throw new Error('the fixture prefix must project');
    }
    try {
        return isDeepStrictEqual(projectClipAction(start, emptyPayloadAction(type), ['track']), start);
    } catch {
        return false;
    }
}

describe('projectClipAction', () => {
    it('projects exactly the shifting action types as something other than keepState', () => {
        const notKeepState = allActionTypes.filter((type) => !projectsAsKeepState(type));

        expect(notKeepState.toSorted()).toEqual(shiftingActionTypes);
    });

    it('leaves a clip and its lanes untouched for every action type outside the shifting entries', () => {
        const keepState = allActionTypes.filter((type) => !shiftingActionTypes.includes(type));

        expect(keepState.length).toBeGreaterThan(shiftingActionTypes.length);
        expect(keepState.filter((type) => !projectsAsKeepState(type))).toEqual([]);
    });
});
