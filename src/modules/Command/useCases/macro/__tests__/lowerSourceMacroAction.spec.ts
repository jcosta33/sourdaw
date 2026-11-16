import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerKernelPorts } from '#/app/registerKernelPorts';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, getArrangementHandlers, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { AppActionConflictError } from '../../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../../stores/handlerRegistry';
import { getCommandHandler } from '../../getCommandHandler';
import { lowerSourceMacroAction } from '../lowerSourceMacroAction';

type Described = ReturnType<NonNullable<ReturnType<typeof getCommandHandler>>['describe']>;

function describeAction(action: AppAction): Described {
    const handler = getCommandHandler(action);
    if (!handler) {
        throw new Error(`No handler is registered for ${action.type}`);
    }
    return handler.describe(action);
}

function recordedInverse(action: AppAction): AppAction {
    const { inverseAction } = describeAction(action);
    if (!inverseAction) {
        throw new Error(`${action.type} recorded no inverse`);
    }
    return inverseAction;
}

function recordedRedo(action: AppAction): AppAction {
    const { redoAction } = describeAction(action);
    if (!redoAction) {
        throw new Error(`${action.type} recorded no redo`);
    }
    return redoAction;
}

registerKernelPorts();

const promotion: Extract<AppAction, { type: 'restoreTempoEdit' }>['payload']['audioSourcePromotion'] = {
    version: 1,
    clips: [],
    takes: [],
    regions: [],
    gaps: [],
    gapFieldPresence: [],
};

describe('lowerSourceMacroAction on captured source actions', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        setTrackStoreState({
            ...structuredClone(defaultTrackState),
            tracks: [createTrack({ id: 'track', name: 'Track', kind: 'audio' })],
        });
        addClip({ id: 'clip', trackId: 'track', name: 'Clip', type: 'audio', startBeat: 4, endBeat: 12 });
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('lowers a restoreAudioClipStartTrim to the trimClipStart of the head it names', () => {
        const forward: AppAction = { type: 'trimClipStart', payload: { clipId: 'clip', newStartBeat: 6 } };
        const inverse = recordedInverse(forward);
        const redo = recordedRedo(forward);

        expect(inverse.type).toBe('restoreAudioClipStartTrim');
        expect(lowerSourceMacroAction(inverse, new Map())).toEqual({
            type: 'trimClipStart',
            payload: { clipId: 'clip', newStartBeat: 4 },
        });
        expect(lowerSourceMacroAction(redo, new Map())).toEqual({
            type: 'trimClipStart',
            payload: { clipId: 'clip', newStartBeat: 6 },
        });
    });

    it('lowers a restoreAudioClipSlip to the slipClipContent of the offset it names', () => {
        const forward: AppAction = {
            type: 'slipClipContent',
            payload: { clipId: 'clip', clipType: 'audio', offset: 2 },
        };
        const inverse = recordedInverse(forward);
        const redo = recordedRedo(forward);

        expect(inverse.type).toBe('restoreAudioClipSlip');
        expect(lowerSourceMacroAction(redo, new Map())).toEqual({
            type: 'slipClipContent',
            payload: { clipId: 'clip', clipType: 'audio', offset: 2 },
        });
        expect(lowerSourceMacroAction(inverse, new Map())).toEqual({
            type: 'slipClipContent',
            payload: { clipId: 'clip', clipType: 'audio', offset: 0 },
        });
    });

    it('lowers a restoreTempoEdit to a setTempo bound to the row id the replay mapped', () => {
        const restore: AppAction = {
            type: 'restoreTempoEdit',
            payload: {
                bpm: 90,
                expectedBpm: 120,
                tempoChangeId: 'recorded',
                sourceDirection: 'restore',
                audioSourcePromotion: promotion,
            },
        };

        expect(lowerSourceMacroAction(restore, new Map([['recorded', 'actual']]))).toEqual({
            type: 'setTempo',
            payload: { bpm: 90, tempoChangeId: 'actual' },
        });
        expect(lowerSourceMacroAction(restore, new Map())).toEqual({
            type: 'setTempo',
            payload: { bpm: 90, tempoChangeId: 'recorded' },
        });
    });

    it('lowers a restoreTempoEdit of the base tempo without a row id', () => {
        const restore: AppAction = {
            type: 'restoreTempoEdit',
            payload: {
                bpm: 100,
                expectedBpm: 120,
                tempoChangeId: null,
                sourceDirection: 'promote',
                audioSourcePromotion: promotion,
            },
        };

        expect(lowerSourceMacroAction(restore, new Map())).toEqual({
            type: 'setTempo',
            payload: { bpm: 100, tempoChangeId: null },
        });
    });

    it('refuses a captured source action whose payload the owner does not accept', () => {
        const malformed: AppAction = JSON.parse(
            '{"type":"restoreTempoEdit","payload":{"bpm":90,"expectedBpm":120,"tempoChangeId":"","sourceDirection":"restore"}}'
        );

        expect(() => lowerSourceMacroAction(malformed, new Map())).toThrow(AppActionConflictError);
    });
});
