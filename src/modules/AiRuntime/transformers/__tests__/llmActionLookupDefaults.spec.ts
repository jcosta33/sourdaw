import { describe, expect, it } from 'vitest';

import { acceptsSidechainInput } from '#/modules/AudioEngine/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { getAutomationTransformLaneId } from '../llmAutomationTransformLaneId';
import { getClipTargetIds } from '../llmClipTargetIds';
import { getDeviceBatchTarget } from '../llmDeviceBatchTarget';
import { getMutationKeys } from '../llmMutationKeys';
import { applyAcceptedRoutingAction } from '../llmRoutingProjection';
import { hasInvalidatingSidechainLifecycleMutation } from '../llmSidechainLifecycle';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 4,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 4,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 1,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

// An action no lookup lists a behaviour for, so every lookup answers its default.
const unlistedAction: RuntimeAction = { type: 'toggleSidebar' };

describe('LLM bridge per-action lookups: default entries', () => {
    it('gives an unlisted action no mutation keys', () => {
        expect(getMutationKeys(unlistedAction, context, [])).toEqual([]);
    });

    it('gives an unlisted action no clip targets', () => {
        expect(getClipTargetIds(unlistedAction)).toEqual([]);
    });

    it('gives an unlisted action no automation transform lane', () => {
        expect(getAutomationTransformLaneId(unlistedAction)).toBeNull();
    });

    it('gives an unlisted action no device batch target', () => {
        expect(getDeviceBatchTarget(unlistedAction, context)).toBeNull();
    });

    it('leaves the routing context unchanged for an unlisted action', () => {
        expect(applyAcceptedRoutingAction(context, unlistedAction, acceptsSidechainInput)).toBe(context);
    });

    it('never treats an unlisted action as a sidechain lifecycle invalidation', () => {
        expect(hasInvalidatingSidechainLifecycleMutation([unlistedAction], context, acceptsSidechainInput)).toBe(false);
    });
});

describe('LLM bridge per-action lookups: inherited Object.prototype names', () => {
    const inheritedAction: RuntimeAction = JSON.parse('{"type":"constructor","payload":{}}');

    it('gives an inherited name no mutation keys', () => {
        expect(getMutationKeys(inheritedAction, context, [])).toEqual([]);
    });

    it('gives an inherited name no clip targets', () => {
        expect(getClipTargetIds(inheritedAction)).toEqual([]);
    });

    it('gives an inherited name no automation transform lane', () => {
        expect(getAutomationTransformLaneId(inheritedAction)).toBeNull();
    });

    it('gives an inherited name no device batch target', () => {
        expect(getDeviceBatchTarget(inheritedAction, context)).toBeNull();
    });

    it('leaves the routing context unchanged for an inherited name', () => {
        // `constructor` would return its first argument, so a name that returns something else tells the guard apart.
        const stringifyingAction: RuntimeAction = JSON.parse('{"type":"toString","payload":{}}');
        expect(applyAcceptedRoutingAction(context, stringifyingAction, acceptsSidechainInput)).toBe(context);
    });

    it('never treats an inherited name as a sidechain lifecycle invalidation', () => {
        expect(hasInvalidatingSidechainLifecycleMutation([inheritedAction], context, acceptsSidechainInput)).toBe(
            false
        );
    });
});

describe('LLM bridge per-action lookups: listed entries', () => {
    it('reads the lane of an automation transform and its mutation key', () => {
        const action: RuntimeAction = { type: 'thinAutomation', payload: { laneId: 'lane-1', tolerance: 0.1 } };
        expect(getAutomationTransformLaneId(action)).toBe('lane-1');
        expect(getMutationKeys(action, context, [])).toEqual(['automation-lane-points:lane-1']);
    });

    it('lists every clip-scoped key of a split in the fixed order', () => {
        const action: RuntimeAction = { type: 'splitClip', payload: { clipId: 'c1', beat: 2 } };
        expect(getClipTargetIds(action)).toEqual(['c1']);
        expect(getMutationKeys(action, context, [])).toEqual([
            'clip:c1:membership',
            'clip:c1:name',
            'clip:c1:geometry',
            'clip:c1:gain',
            'clip:c1:muted',
            'clip:c1:color',
            'clip:c1:fades',
            'clip:c1:lock',
            'clip:c1:loop',
            'clip:c1:stretch',
            'clip:c1:notes',
        ]);
    });

    it('targets a new device as an add with no device id', () => {
        const action: RuntimeAction = { type: 'addDevice', payload: { trackId: 't1', deviceType: 'compressor' } };
        expect(getDeviceBatchTarget(action, context)).toEqual({ deviceId: null, trackId: 't1', kind: 'add' });
    });
});
