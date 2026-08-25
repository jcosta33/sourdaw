import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { validateArbitraryCommandListEvidence } from '../validateArbitraryCommandListEvidence';

const sidechainDevice = (id: string) => ({
    id,
    name: 'Sidechain Compressor',
    type: 'builtin-sidechain-compressor',
    bypassed: false,
});

const track = (id: string, name: string, devices = []) => ({
    id,
    name,
    kind: 'audio' as const,
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 1,
    pan: 0,
    automationMode: 'read' as const,
    clipCount: 0,
    deviceCount: devices.length,
    clips: [],
    devices,
});

const context: ProjectContext = {
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
    tracks: [
        track('track-kick', 'Kick'),
        track('track-bass', 'Bass', [sidechainDevice('device-bass-compressor')]),
        track('track-vocals', 'Vocals', [sidechainDevice('device-vocals-compressor')]),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function compileSidechainRoute(targetDeviceId: string) {
    return compileArbitraryCommandList({
        context,
        revision: 'revision-sidechain-device-ownership',
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: 'Route Kick into Bass.',
                        constraints: [],
                        scope: {
                            targetIds: ['track-kick', 'track-bass', targetDeviceId],
                            targetRanges: [],
                            protectedTargetIds: [],
                            protectedRanges: [],
                        },
                        capabilityIds: [],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: [],
                        stoppingConditions: [],
                    },
                    list: {
                        schemaVersion: 1,
                        items: [
                            {
                                id: 'route-kick-to-bass',
                                name: 'addSidechainRoute',
                                arguments: { targetTrackId: 'track-bass', targetDeviceId },
                                selector: {
                                    targetArgument: 'sourceTrackId',
                                    entity: 'track',
                                    where: { name: 'Kick' },
                                    quantity: { unit: 'targets', exactly: 1 },
                                },
                            },
                        ],
                    },
                },
            },
        ],
    });
}

describe('sidechain device ownership', () => {
    it('admits a sidechain device owned by the declared target track', () => {
        expect(compileSidechainRoute('device-bass-compressor')).toMatchObject({ status: 'accepted' });
    });

    it('rejects a sidechain device owned by another track during compilation', () => {
        expect(compileSidechainRoute('device-vocals-compressor')).toEqual({
            status: 'rejected',
            reason: 'Direct command target targetDeviceId is outside the command capability contract.',
        });
    });

    it('rejects forged evidence that swaps a sidechain device across target tracks', () => {
        const compiled = compileSidechainRoute('device-bass-compressor');
        expect(compiled).toMatchObject({ status: 'accepted' });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            return;
        }
        const commands = compiled.compilerEvidence.commands.map((command) => ({
            ...command,
            arguments:
                command.name === 'addSidechainRoute'
                    ? { ...command.arguments, targetDeviceId: 'device-vocals-compressor' }
                    : command.arguments,
        }));
        const evidence = {
            ...compiled.compilerEvidence,
            commands,
            items: compiled.compilerEvidence.items.map((item) => ({
                ...item,
                declaredCommandIdentities: item.declaredCommandIdentities.map((identity) =>
                    identity.replaceAll('device-bass-compressor', 'device-vocals-compressor')
                ),
                directTargets: item.directTargets?.map((target) =>
                    target.argument === 'targetDeviceId'
                        ? { ...target, stableIds: ['device-vocals-compressor'] }
                        : target
                ),
            })),
            proposalScope: {
                ...compiled.compilerEvidence.proposalScope,
                targetIds: ['track-kick', 'track-bass', 'device-vocals-compressor'],
            },
            providerKnownTargetIds: ['track-bass', 'track-kick', 'device-vocals-compressor'],
        };

        expect(
            validateArbitraryCommandListEvidence({
                evidence,
                calls: commands,
                context,
                revision: 'revision-sidechain-device-ownership',
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command compiler evidence direct targets are invalid.',
        });
    });
});
