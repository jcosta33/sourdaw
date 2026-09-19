import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane, getAutomationHandlers, getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';

const SOURCE_LANE_ID = 'lane-source';
const FOLLOWER_LANE_ID = 'lane-follower';

function projectContext(): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 8,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 8,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        tracks: [
            {
                id: 'track-vocals',
                name: 'Vocals',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
        ],
        automationLanes: [
            {
                id: SOURCE_LANE_ID,
                trackId: 'track-vocals',
                parameterId: 'gain',
                name: 'Source Gain',
                enabled: true,
                minValue: 0,
                maxValue: 1,
                points: [{ beat: 0, value: 0.5, curve: 'linear' }],
            },
            {
                id: FOLLOWER_LANE_ID,
                trackId: 'track-vocals',
                parameterId: 'gain',
                name: 'Follower Gain',
                enabled: true,
                minValue: 0,
                maxValue: 1,
                linkedLaneId: SOURCE_LANE_ID,
                points: [],
            },
        ],
        selectedTrackId: 'track-vocals',
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'automation',
        playheadPosition: 1,
    };
}

function seedAutomation() {
    const source = { ...createAutomationLane('track-vocals', 'gain', 'Source Gain', 0, 1), id: SOURCE_LANE_ID };
    const follower = {
        ...createAutomationLane('track-vocals', 'gain', 'Follower Gain', 0, 1),
        id: FOLLOWER_LANE_ID,
        linkedLaneId: SOURCE_LANE_ID,
    };
    automationStore.set({
        lanes: [
            {
                ...source,
                points: [{ id: 'point-source', beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
            },
            follower,
        ],
    });
}

function lanePointValues(laneId: string): number[] {
    return (automationStore.value?.lanes.find((lane) => lane.id === laneId)?.points ?? []).map((point) => point.value);
}

describe('linked automation level admission', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('linked automation level admission');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        seedAutomation();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        [
            'absolute',
            'add automation point on lane-follower at beat 1 at -6 dB',
            { laneId: FOLLOWER_LANE_ID, beat: 1, valueDb: -6 },
        ],
        [
            'relative',
            'add automation point on lane-follower at beat 1 down 6 dB',
            { laneId: FOLLOWER_LANE_ID, beat: 1, deltaDb: -6 },
        ],
    ])('rejects a %s decibel point before the linked follower can be written', async (_label, prompt, args) => {
        const result = bridgeGroundedLlmToolCalls({
            calls: [{ name: 'addAutomationPoint', arguments: args }],
            prompt,
            context: projectContext(),
            markerSignatures: [],
            sectionSignatures: [],
        });

        for (const action of result.actions) {
            await executeAppAction(action);
        }

        expect(lanePointValues(SOURCE_LANE_ID)).toEqual([0.5]);
        expect(lanePointValues(FOLLOWER_LANE_ID)).toEqual([]);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 1)).toBe(0.5);
        expect(result.actions).toEqual([]);
        expect(result.rejections[0]?.reason).toBe(
            'Expected an existing automation lane, an unused non-negative beat, and a value within lane bounds'
        );
    });
});
