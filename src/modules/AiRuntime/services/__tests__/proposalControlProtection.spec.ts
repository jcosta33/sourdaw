import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { proposalControlProtection } from '../proposalControlProtection';

type Lane = NonNullable<ProjectContext['automationLanes']>[number];

function lane(id: string, trackId: string, parameterId: string): Lane {
    return {
        id,
        trackId,
        parameterId,
        name: `${trackId} ${parameterId}`,
        enabled: true,
        minValue: 0,
        maxValue: 1,
        points: [{ beat: 0, value: 0.8, curve: 'linear' }],
    };
}

const CONTEXT: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    automationLanes: [
        lane('lane-gain', 'track-vocals', 'gain'),
        lane('lane-send', 'track-vocals', 'send:track-room'),
        lane('lane-pan', 'track-vocals', 'pan'),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function readOperations(actionType: string, payload: Record<string, unknown>, automation: boolean) {
    return proposalControlProtection.readEffects({
        actionType,
        payload,
        context: CONTEXT,
        declaredOwners: ['track-vocals'],
        automation,
        laneTargetIds: [],
    });
}

// A persisted or model-written name that no action type owns, and one that only Object.prototype owns.
const unknownNames: readonly string[] = JSON.parse('["retiredMixerAction", "constructor", "__proto__"]');

describe('proposalControlProtection canonical control', () => {
    it('folds a gain range and a VCA gain write into the track gain control', () => {
        expect(readOperations('automateTrackGainRange', {}, false)).toEqual([
            { trackId: 'track-vocals', operations: ['setTrackGain'] },
        ]);
        expect(readOperations('setVcaGain', {}, false)).toEqual([
            { trackId: 'track-vocals', operations: ['setTrackGain'] },
        ]);
    });

    it('folds every send write into the send control', () => {
        for (const actionType of ['addSend', 'removeSend', 'automateSendRange', 'automateSendRanges']) {
            expect(readOperations(actionType, {}, false)).toEqual([
                { trackId: 'track-vocals', operations: ['setSend'] },
            ]);
        }
    });

    it('keeps an action that folds into no control as its own operation', () => {
        expect(readOperations('renameTrack', {}, false)).toEqual([
            { trackId: 'track-vocals', operations: ['renameTrack'] },
        ]);
    });

    it.each(unknownNames)('keeps the name %s as its own operation', (name) => {
        expect(readOperations(name, {}, false)).toEqual([{ trackId: 'track-vocals', operations: [name] }]);
    });

    it('does not equate two retired names that no action type owns', () => {
        const control = { trackId: 'track-vocals', operations: ['retiredMixerAction'] };

        expect(proposalControlProtection.matches(control, 'renameTrack', ['otherRetiredAction'])).toBe(false);
        expect(proposalControlProtection.matches(control, 'renameTrack', ['retiredMixerAction'])).toBe(true);
    });
});

describe('proposalControlProtection automation fallback scope', () => {
    it('reads the gain lane of every declared owner for a gain range with no parameter in its payload', () => {
        expect(readOperations('automateTrackGainRange', {}, true)).toEqual([
            { trackId: 'track-vocals', operations: ['setTrackGain'] },
        ]);
    });

    it('reads the named bus send of every declared owner for a send range', () => {
        expect(readOperations('automateSendRange', { busId: 'track-room' }, true)).toEqual([
            { trackId: 'track-vocals', operations: ['setSend'] },
        ]);
    });

    it('reads every lane a declared owner holds for an automation mode change', () => {
        const [effect] = readOperations('setAutomationMode', {}, true);

        expect(effect?.operations.toSorted()).toEqual(['setSend', 'setTrackGain', 'setTrackPan']);
    });

    it('records an automation action with no fallback scope under its own name', () => {
        expect(readOperations('thinAutomation', {}, true)).toEqual([
            { trackId: 'track-vocals', operations: ['thinAutomation'] },
        ]);
    });

    it.each(unknownNames)('records the name %s under its own name without reading a scope', (name) => {
        expect(readOperations(name, {}, true)).toEqual([{ trackId: 'track-vocals', operations: [name] }]);
    });
});

describe('proposalControlProtection linked lanes', () => {
    const follower: Lane = { ...lane('lane-follower', 'track-room', 'pan'), linkedLaneId: 'lane-gain' };
    const linkedContext: ProjectContext = {
        ...CONTEXT,
        automationLanes: [lane('lane-gain', 'track-vocals', 'gain'), lane('lane-pan', 'track-vocals', 'pan'), follower],
    };

    function readLinkedOperations(actionType: string) {
        return proposalControlProtection.readEffects({
            actionType,
            payload: { trackId: 'track-vocals', parameterId: 'gain' },
            context: linkedContext,
            declaredOwners: ['track-vocals'],
            automation: true,
            laneTargetIds: [],
        });
    }

    it('reaches the follower of a source lane when the action changes source points', () => {
        expect(readLinkedOperations('addAutomationPoint')).toContainEqual({
            trackId: 'track-room',
            operations: ['setTrackPan'],
        });
    });

    it.each(['addAutomationLane', 'setAutomationLaneEnabled', 'setAutomationMode'])(
        'leaves the follower alone when %s changes no source point',
        (actionType) => {
            expect(readLinkedOperations(actionType).map((effect) => effect.trackId)).toEqual(['track-vocals']);
        }
    );

    it.each(unknownNames)('reaches the follower for the unowned name %s', (name) => {
        expect(readLinkedOperations(name).map((effect) => effect.trackId)).toContain('track-room');
    });
});
