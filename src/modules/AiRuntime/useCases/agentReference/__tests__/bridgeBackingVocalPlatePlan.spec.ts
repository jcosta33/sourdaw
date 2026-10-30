import { afterEach, describe, expect, it } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { configureMetricGoalProject, resetMetricGoalProject } from '../../__tests__/metricGoalWorkflowFixture';
import { getProjectContext } from '../../getProjectContext';
import { materializeActionStateGuards } from '../../materializeActionStateGuards';
import { bridgeBackingVocalPlatePlan, freezeWorkflowNativeLiteralUses } from '../bridgeBackingVocalPlatePlan';
import { getBackingVocalPlatePromptScope } from '../getBackingVocalPlatePromptScope';
import { materializeBatchLocalActionIdentities } from '../materializeBatchLocalActionIdentities';

afterEach(resetMetricGoalProject);

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 0,
    metronomeEnabled: false,
    metronomeVolume: 1,
    masterGain: 1,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('bridgeBackingVocalPlatePlan', () => {
    it('produces native field provenance only from the exact selected app workflow and its created identities', () => {
        const backing = createTrack({ id: 'backing', name: 'Backing Vocals', kind: 'audio' });
        backing.devices = [
            { id: 'backing-reverb', name: 'Room', type: 'builtin-reverb', bypassed: false, parameterValues: {} },
        ];
        configureMetricGoalProject({
            label: 'native plate producer',
            tracks: [backing, createTrack({ id: 'lead', name: 'Lead Vocal', kind: 'audio' })],
            sections: [{ id: 'chorus', name: 'Chorus', startBeat: 0, endBeat: 32, color: '#fff' }],
        });
        const actualContext = getProjectContext();
        const scope = getBackingVocalPlatePromptScope(actualContext);
        if (scope.status !== 'request') {
            throw new Error(scope.reason);
        }
        const calls = scope.capability.orderedToolPlan;
        const selected = bridgeBackingVocalPlatePlan({ calls, context: actualContext, selected: true });
        if (selected.status !== 'accepted') {
            throw new Error('Expected exact app-owned selected plate workflow');
        }
        const use = selected.nativeLiteralUses[0];
        expect(use).toMatchObject({
            workflow: 'backing-vocal-plate',
            field: 'highPassHz',
            unit: 'Hz',
            value: scope.capability.fixedValues.highPassHz,
        });
        expect(selected.identities).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ actionType: 'createBus', busId: use?.ownerId }),
                expect.objectContaining({ actionType: 'addDevice', deviceId: use?.deviceId }),
            ])
        );
        const identified = materializeBatchLocalActionIdentities(selected.actions, selected.identities);
        expect(identified.status).toBe('accepted');
        if (identified.status !== 'accepted') {
            throw new Error(identified.reason);
        }
        const materialized = materializeActionStateGuards(identified.actions, actualContext, {
            appOwnedRenderTailSeconds: selected.renderTailSeconds,
        });
        expect(materialized.status).toBe('accepted');
        if (materialized.status !== 'accepted' || use === undefined) {
            throw new Error('Expected the real workflow owner and native parameter to materialize');
        }
        expect(materialized.actions[use.ownerActionIndex]).toMatchObject({
            type: 'createBus',
            payload: { busId: use.ownerId },
        });
        expect(materialized.actions[use.deviceActionIndex]).toMatchObject({
            type: 'addDevice',
            payload: { trackId: use.ownerId, deviceId: use.deviceId },
        });
        expect(materialized.actions[use.actionIndex]).toMatchObject({
            type: 'setDeviceParameter',
            payload: { deviceId: use.deviceId, paramId: use.paramId, value: use.value, valueUnit: use.unit },
        });
        expect(
            freezeWorkflowNativeLiteralUses({
                uses: selected.nativeLiteralUses,
                actions: materialized.actions,
                authority: undefined,
                request: 'a 250 Hz high-pass',
            })
        ).toEqual([]);
        expect(
            bridgeBackingVocalPlatePlan({ calls: calls.slice(1), context: actualContext, selected: true })
        ).toMatchObject({ status: 'rejected' });
    });

    it.each(['automateSendRanges', 'renderProjectSections'])(
        'keeps %s unavailable outside the selected workflow admission',
        (name) => {
            const calls = [
                {
                    name,
                    arguments:
                        name === 'automateSendRanges'
                            ? {
                                  trackIds: ['track-bgv'],
                                  busId: 'bus-plate',
                                  sectionIds: ['section-chorus'],
                                  tailBars: 4,
                                  targetLevelDb: -10,
                              }
                            : { sectionIds: ['section-chorus'] },
                },
            ];

            expect(bridgeBackingVocalPlatePlan({ calls, context, selected: false })).toEqual({
                status: 'rejected',
                reason: `${name} is available only through the selected backing-vocal plate workflow`,
            });
        }
    );
});
