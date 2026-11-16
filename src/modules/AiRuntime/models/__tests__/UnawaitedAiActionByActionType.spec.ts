import { describe, expect, it } from 'vitest';

import { unawaitedAiActionByActionType } from '../UnawaitedAiActionByActionType';

describe('unawaitedAiActionByActionType', () => {
    it('marks exactly the project file, import and collaboration actions as unawaited', () => {
        const unawaited = Object.entries(unawaitedAiActionByActionType)
            .filter(([, isUnawaited]) => isUnawaited)
            .map(([type]) => type);

        expect(unawaited.toSorted()).toEqual([
            'exportProject',
            'importAudioFile',
            'importMidiFile',
            'leaveCollabSession',
            'newProject',
            'saveProject',
        ]);
    });

    it('lets an action type the list does not name through', () => {
        expect(unawaitedAiActionByActionType.togglePlayback).toBe(false);
    });
});
