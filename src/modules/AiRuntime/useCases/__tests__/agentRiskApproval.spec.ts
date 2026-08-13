import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collaborationStore } from '#/modules/Collaboration/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    getAgentActionRiskPolicy,
    parseVersionedCommandBatchEnvelope,
    parseVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { describeAgentRiskApproval } from '../describeAgentRiskApproval';
import { getExactAgentActionHash } from '../getExactAgentActionHash';
import { validateAgentRiskApproval } from '../validateAgentRiskApproval';

const baseCollaborationState = structuredClone(collaborationStore.value!);
const executeSetTrackGain = vi.fn();

function createBatch(projectRevision: string) {
    const action = {
        type: 'setTrackGain' as const,
        payload: { expectedGain: 0.8, gain: 0.7, trackId: 'track-vocal' },
    };
    const compiled = compilePlannedActionCommandBatch({
        actions: [action],
        actionLabels: ['Set Vocal gain from 0.8 to 0.7'],
        autoCommit: false,
        context: {
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
                {
                    id: 'track-vocal',
                    name: 'Vocal',
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
                },
            ],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'arrange',
            playheadPosition: 0,
        },
        group: { groupId: 'group-risk-approval', groupLabel: 'Set vocal gain' },
        intent: 'Set the vocal gain',
        projectRevision,
        runId: 'run-risk-approval',
    });
    const parsedCommand = parseVersionedCommandEnvelope(compiled.commandEnvelopes[0]!);
    if (parsedCommand.status === 'invalid') {
        throw new Error(parsedCommand.reason);
    }
    return { action, command: parsedCommand.envelope, commandBatch: compiled.commandBatch };
}

describe('agent risk approval', () => {
    let targetFingerprint = 'track-vocal:v1';

    beforeEach(() => {
        targetFingerprint = 'track-vocal:v1';
        collaborationStore.set({ ...baseCollaborationState, localPeerId: 'actor-a' });
        commandBatchPreflightPort.setProvider(({ targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: captureProjectRevision(),
            projectInvariantsValid: true,
            targetFingerprints: Object.fromEntries(targetIds.map((targetId) => [targetId, targetFingerprint])),
        }));
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'chat' });
        clearPendingActionConfirmations();
        executeSetTrackGain.mockReset();
        registerHandlerMap({
            setTrackGain: {
                execute: executeSetTrackGain,
                describe: () => ({
                    label: 'Set Vocal gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { expectedGain: 0.7, gain: 0.8, trackId: 'track-vocal' },
                    },
                }),
                undoable: true,
            } satisfies ActionHandler<Extract<AppAction, { type: 'setTrackGain' }>>,
        });
    });

    afterEach(() => {
        clearPendingActionConfirmations();
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        collaborationStore.set(structuredClone(baseCollaborationState));
        chatStore.set(null);
    });

    it('escalates registry and contextual risk instead of inferring broader authority', () => {
        expect(getAgentActionRiskPolicy({ operationTypes: ['analyzeMix'] })).toMatchObject({
            decision: 'allow',
            requiredTrustMode: 'analyze-only',
            risk: 'read-only',
        });
        expect(getAgentActionRiskPolicy({ operationTypes: ['removeTrack'] })).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'replace-selection',
            risk: 'destructive-reversible',
        });
        expect(getAgentActionRiskPolicy({ operationTypes: ['importStemSet'] })).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'apply-reversible',
            risk: 'broad-reversible',
        });
        for (const operationType of ['setMasterGain', 'setTempo', 'setTrackOutput']) {
            expect(getAgentActionRiskPolicy({ operationTypes: [operationType] })).toMatchObject({
                decision: 'confirm',
                requiredTrustMode: 'apply-reversible',
                risk: 'authority-sensitive',
            });
        }
        expect(
            getAgentActionRiskPolicy({
                authorityEffects: { routing: true },
                operationTypes: ['setTrackGain'],
            })
        ).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'apply-reversible',
            risk: 'authority-sensitive',
        });
        expect(getAgentActionRiskPolicy({ operationTypes: ['renderProjectSections'] })).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'destructive-commit',
            risk: 'external-effect',
        });
        expect(getAgentActionRiskPolicy({ operationTypes: ['createDrumPreviewBranches'] })).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'create-branch',
            risk: 'broad-reversible',
        });
        expect(
            getAgentActionRiskPolicy({ operationTypes: ['setTrackGain'], signals: { unexpectedlyBroad: true } })
        ).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'apply-reversible',
            risk: 'broad-reversible',
        });
        expect(
            getAgentActionRiskPolicy({
                consequences: { audioUpload: true, maxImportedAssets: 1, maxRenderJobs: 2, remoteGeneration: true },
                operationTypes: ['setTrackGain'],
            })
        ).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'destructive-commit',
            risk: 'external-effect',
        });
        expect(
            getAgentActionRiskPolicy({ operationTypes: ['setTrackGain'], signals: { ambiguous: true } })
        ).toMatchObject({ decision: 'reject', requiredTrustMode: 'destructive-commit' });
        expect(
            getAgentActionRiskPolicy({ operationTypes: ['setTrackGain'], signals: { capabilityDegraded: true } })
        ).toMatchObject({ decision: 'reject', requiredTrustMode: 'destructive-commit' });
        expect(getAgentActionRiskPolicy({ operationTypes: ['setTrackGain'], signals: { stale: true } })).toMatchObject({
            decision: 'reject',
            requiredTrustMode: 'destructive-commit',
        });
    });

    it('binds exact command hashes, revision, fingerprints, consequences, trust mode, and local actor', () => {
        const revision = captureProjectRevision();
        const { command, commandBatch } = createBatch(revision);
        const approval = compileAgentRiskApproval({ commandBatch });

        expect(approval).toEqual({
            schemaVersion: 1,
            actionHashes: [getExactAgentActionHash({ operation: command.operation, arguments: command.arguments })],
            sourceRevision: revision,
            targetFingerprints: { 'track-vocal': targetFingerprint },
            consequences: {
                audioUpload: false,
                fileAccess: false,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
                remoteGeneration: false,
            },
            localActorId: 'actor-a',
            policy: {
                decision: 'confirm',
                reasons: ['The planning workflow requires explicit confirmation.'],
                requiredTrustMode: 'apply-reversible',
                risk: 'bounded-reversible',
            },
        });
        expect(validateAgentRiskApproval({ approval, commandBatch, currentRevision: revision })).toEqual({
            status: 'valid',
        });
        expect(describeAgentRiskApproval(approval)).toBe(
            'Approval risk: bounded-reversible\nTrust mode: apply-reversible\nCost/data consequences: none\nAuthority reasons: The planning workflow requires explicit confirmation.'
        );
        expect(approval.actionHashes[0]).not.toBe(command.argumentsDigest);
        expect(approval.actionHashes[0]).toMatch(/^canonical-json-utf8:[0-9a-f]+$/);
    });

    it('escalates an auto-commit registry batch after resolving its exact command scope', () => {
        const revision = captureProjectRevision();
        const context = {
            tempo: 120,
            timeSignature: [4, 4] as [number, number],
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
                {
                    id: 'track-vocal',
                    name: 'Vocal',
                    kind: 'audio' as const,
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read' as const,
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [
                        {
                            id: 'clip-source',
                            name: 'Source',
                            type: 'audio' as const,
                            startBeat: 0,
                            endBeat: 4,
                            noteCount: 0,
                        },
                    ],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-vocal',
            selectedClipId: 'clip-source',
            selectedClipIds: ['clip-source'],
            activeView: 'arrange' as const,
            playheadPosition: 0,
        };

        const compiled = compileAgentActionExecution({
            actions: [
                {
                    type: 'setTrackGain',
                    payload: { expectedGain: 0.8, gain: 0.7, trackId: 'track-vocal' },
                },
                {
                    type: 'setTrackGain',
                    payload: { expectedGain: 0.7, gain: 0.6, trackId: 'track-vocal' },
                },
            ],
            actionLabels: ['Set Vocal gain from 0.8 to 0.7', 'Set Vocal gain from 0.7 to 0.6'],
            context,
            group: { groupId: 'group-gain', groupLabel: 'Set Vocal gain' },
            intent: 'Set Vocal gain',
            projectRevision: revision,
            requiresConfirmation: false,
            runId: 'run-gain',
        });

        expect(compiled.requiresConfirmation).toBe(true);
        if (!compiled.requiresConfirmation) {
            throw new Error('Expected exact batch risk to require confirmation');
        }
        expect(compiled.agentApproval.policy).toMatchObject({
            decision: 'confirm',
            requiredTrustMode: 'apply-reversible',
            risk: 'broad-reversible',
        });
        const parsed = parseVersionedCommandBatchEnvelope(
            compiled.commandBatch.serialized,
            compiled.commandBatch.authority
        );
        expect(parsed.status).toBe('valid');
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        expect(parsed.envelope.grants.autoCommit).toBe(false);
    });

    it('invalidates any changed approval binding immediately before execution', async () => {
        const revision = captureProjectRevision();
        const { action, commandBatch } = createBatch(revision);
        const approval = compileAgentRiskApproval({ commandBatch });
        chatStore.set({
            messages: [
                {
                    id: 'assistant-risk-approval',
                    role: 'assistant',
                    content: 'Approve?',
                    timestamp: Date.now(),
                },
            ],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        });
        const proposed = proposePendingActionConfirmation({
            actions: [action],
            actionLabels: ['Set Vocal gain from 0.8 to 0.7'],
            affectedIds: ['track-vocal'],
            agentApproval: approval,
            assistantMessageId: 'assistant-risk-approval',
            commandBatch,
            executionMode: 'atomic',
            id: 'confirmation-risk-approval',
            projectRevision: revision,
            prompt: 'Set the vocal gain',
            risk: { level: 'bounded-reversible', reason: null },
        });
        if (!proposed?.approvalSnapshot.agentApproval) {
            throw new Error('Expected an immutable agent approval snapshot');
        }
        proposed.approvalSnapshot.agentApproval.localActorId = 'tampered-read';
        expect(getPendingActionConfirmation('confirmation-risk-approval')?.approvalSnapshot.agentApproval).toEqual(
            approval
        );

        collaborationStore.set({ ...collaborationStore.value!, localPeerId: 'actor-b' });
        const actorMismatch = await confirmPendingChatActions({ confirmationId: 'confirmation-risk-approval' });
        expect(actorMismatch.status).toBe('failed');
        if (actorMismatch.status !== 'failed') {
            throw new Error('Expected the changed actor to fail approval');
        }
        expect(actorMismatch.reason).toContain('local actor');
        expect(executeSetTrackGain).not.toHaveBeenCalled();

        collaborationStore.set({ ...collaborationStore.value!, localPeerId: 'actor-a' });
        targetFingerprint = 'track-vocal:v2';
        const targetMismatch = validateAgentRiskApproval({ approval, commandBatch, currentRevision: revision });
        expect(targetMismatch.status).toBe('invalid');
        if (targetMismatch.status !== 'invalid') {
            throw new Error('Expected the changed target to invalidate approval');
        }
        expect(targetMismatch.reason).toContain('target fingerprints');
        targetFingerprint = 'track-vocal:v1';
        const hashMismatch = validateAgentRiskApproval({
            approval: { ...approval, actionHashes: ['fnv1a32:tampered'] },
            commandBatch,
            currentRevision: revision,
        });
        expect(hashMismatch.status).toBe('invalid');
        if (hashMismatch.status !== 'invalid') {
            throw new Error('Expected the changed action hash to invalidate approval');
        }
        expect(hashMismatch.reason).toContain('action hashes');
        const consequenceMismatch = validateAgentRiskApproval({
            approval: {
                ...approval,
                consequences: { ...approval.consequences, maxRenderJobs: 1 },
            },
            commandBatch,
            currentRevision: revision,
        });
        expect(consequenceMismatch.status).toBe('invalid');
        if (consequenceMismatch.status !== 'invalid') {
            throw new Error('Expected changed consequences to invalidate approval');
        }
        expect(consequenceMismatch.reason).toContain('cost or data consequences');
        const policyMismatch = validateAgentRiskApproval({
            approval: {
                ...approval,
                policy: { ...approval.policy, requiredTrustMode: 'destructive-commit' },
            },
            commandBatch,
            currentRevision: revision,
        });
        expect(policyMismatch.status).toBe('invalid');
        if (policyMismatch.status !== 'invalid') {
            throw new Error('Expected a changed trust mode to invalidate approval');
        }
        expect(policyMismatch.reason).toContain('trust mode or risk policy');
        const revisionMismatch = validateAgentRiskApproval({
            approval,
            commandBatch,
            currentRevision: 'different-revision',
        });
        expect(revisionMismatch.status).toBe('invalid');
        if (revisionMismatch.status !== 'invalid') {
            throw new Error('Expected a changed source revision to invalidate approval');
        }
        expect(revisionMismatch.reason).toContain('source revision');
    });
});
