import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    getAgentActionRiskPolicy,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { buildAgentDomainPreviews } from '../agentDomainPreview/buildAgentDomainPreviews';
import { previewAudioAudition } from '../agentDomainPreview/previewAudioAudition';
import { previewAutomationCurve } from '../agentDomainPreview/previewAutomationCurve';
import { previewDeviceGraph } from '../agentDomainPreview/previewDeviceGraph';
import { previewMidiOverlay } from '../agentDomainPreview/previewMidiOverlay';
import { resolveAgentDomainPreviewSupport } from '../agentDomainPreview/resolveAgentDomainPreviewSupport';
import { resolveAgentPreviewDomains } from '../agentDomainPreview/resolveAgentPreviewDomains';
import { compileAgentActionExecution } from '../compileAgentActionExecution';

import {
    configureAiWorkflowCommandCheckpointRuntime,
    resetAiWorkflowCommandCheckpointRuntime,
} from './aiWorkflowCommandCheckpointRuntime';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: vi.fn(() => null),
}));

const baseCollaborationState = structuredClone(collaborationStore.value!);

/**
 * The projected root document an isolated command preview returns: one key per
 * CRDT slot, each holding the state of the store that owns it.
 */
function createProjectedDocument(): Readonly<Record<string, unknown>> {
    return {
        tracks: {
            selectedTrackId: null,
            tracks: [
                { id: 'master', kind: 'master', outputId: 'hw_out', devices: [], sends: [] },
                {
                    id: 'bus-a',
                    kind: 'bus',
                    outputId: 'master',
                    devices: [{ id: 'dev-comp', type: 'crust', name: 'Crust' }],
                    sends: [],
                },
                {
                    id: 'track-1',
                    kind: 'audio',
                    outputId: 'master',
                    devices: [],
                    sends: [{ busId: 'bus-a', level: 0.5, preFader: false }],
                },
            ],
        },
        sidechainRoutes: {
            routes: [
                {
                    id: 'route-1',
                    sourceTrackId: 'track-1',
                    targetTrackId: 'bus-a',
                    targetDeviceId: 'dev-comp',
                    targetParameterId: 'threshold',
                    gain: 1,
                },
            ],
        },
        midi: {
            probabilitySeed: 1,
            notesByClipId: {
                'clip-1': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                'clip-2': [{ id: 'note-2', pitch: 67, startBeat: 2, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        },
        automation: {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    points: [
                        { beat: 4, value: 0.9, curve: 'linear', tension: 0 },
                        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
                        { beat: 2, value: 0.5, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                },
                {
                    id: 'lane-2',
                    trackId: 'bus-a',
                    parameterId: 'pan',
                    points: [{ beat: 0, value: 0, curve: 'linear', tension: 0 }],
                    objects: [],
                },
            ],
        },
    };
}

const renameTrack = { type: 'renameTrack', payload: { trackId: 'track-1', name: 'Lead' } } satisfies AppAction;
const addDevice = {
    type: 'addDevice',
    payload: { trackId: 'track-1', deviceType: 'crust' },
} satisfies AppAction;
const addAutomationPoint = {
    type: 'addAutomationPoint',
    payload: { laneId: 'lane-1', beat: 1, value: 0.3 },
} satisfies AppAction;
const addNotes = {
    type: 'addNotes',
    payload: { clipId: 'clip-1', notes: [{ pitch: 62, startBeat: 0, duration: 1, velocity: 96 }] },
} satisfies AppAction;
const addAudioClip = {
    type: 'addClip',
    payload: {
        trackId: 'track-1',
        startBeat: 0,
        endBeat: 4,
        name: 'Loop',
        type: 'audio',
        audioBufferId: 'buffer-1',
    },
} satisfies AppAction;
const generateBassline = {
    type: 'generateBassline',
    payload: { clipId: 'clip-1', trackId: 'track-1' },
} satisfies AppAction;
const trimClipEnd = { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 3 } } satisfies AppAction;

function previewableHandler(): ActionHandler {
    return {
        execute: () => undefined,
        describe: () => ({ label: 'Preview-certified action' }),
        undoable: true,
        previewExecution: 'isolated-project',
    };
}

function externalHandler(): ActionHandler {
    return {
        execute: () => undefined,
        describe: () => ({ label: 'External action' }),
        undoable: true,
        previewExecution: 'unsupported-external',
    };
}

function registerPreviewHandlers(): void {
    registerHandlerMap({
        addClip: previewableHandler(),
        addDevice: previewableHandler(),
        addNotes: previewableHandler(),
        addAutomationPoint: previewableHandler(),
        trimClipEnd: previewableHandler(),
        generateBassline: externalHandler(),
    });
}

function cachedBuffer(): AudioBuffer {
    return { duration: 2.5, sampleRate: 48000, numberOfChannels: 2 } as unknown as AudioBuffer;
}

describe('agent domain preview adapters', () => {
    beforeEach(() => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        registerPreviewHandlers();
    });

    afterEach(() => {
        clearHandlerRegistry();
        vi.mocked(getCachedAudioBuffer).mockReset();
    });

    describe('domain classification', () => {
        it('maps an operation that changes no previewable domain to none', () => {
            expect(resolveAgentPreviewDomains([renameTrack])).toEqual([]);
            expect(resolveAgentDomainPreviewSupport([renameTrack])).toEqual([]);
            expect(
                buildAgentDomainPreviews({ actions: [renameTrack], projectDocument: createProjectedDocument() })
            ).toEqual([]);
        });

        it('maps a device chain change to the device graph', () => {
            expect(resolveAgentPreviewDomains([addDevice])).toEqual(['device-graph']);
        });

        it('maps an automation write to the automation curve', () => {
            expect(resolveAgentPreviewDomains([addAutomationPoint])).toEqual(['automation-curve']);
        });

        it('maps a note write to the midi overlay', () => {
            expect(resolveAgentPreviewDomains([addNotes])).toEqual(['midi-overlay']);
        });

        it('maps an audio clip placement to the audio audition', () => {
            expect(resolveAgentPreviewDomains([addAudioClip])).toEqual(['audio-audition']);
        });

        it('returns the union of touched domains in declaration order', () => {
            expect(resolveAgentPreviewDomains([addNotes, addDevice])).toEqual(['midi-overlay', 'device-graph']);
        });
    });

    describe('domain support', () => {
        it('reports a domain unsupported when one of its actions cannot run in the isolated projection', () => {
            expect(resolveAgentDomainPreviewSupport([generateBassline])).toEqual([
                { domain: 'midi-overlay', status: 'unsupported', reason: 'external-execution' },
            ]);
        });

        it('supports an audition of an audio clip whose buffer is cached', () => {
            vi.mocked(getCachedAudioBuffer).mockReturnValue(cachedBuffer());

            expect(resolveAgentDomainPreviewSupport([addAudioClip])).toEqual([
                { domain: 'audio-audition', status: 'supported' },
            ]);
        });

        it('refuses an audition of an audio clip whose buffer is not cached', () => {
            expect(resolveAgentDomainPreviewSupport([addAudioClip])).toEqual([
                { domain: 'audio-audition', status: 'unsupported', reason: 'isolated-render-unavailable' },
            ]);
        });

        it('refuses an audition of clip audio that only a render could produce', () => {
            vi.mocked(getCachedAudioBuffer).mockReturnValue(cachedBuffer());

            expect(resolveAgentDomainPreviewSupport([trimClipEnd])).toEqual([
                { domain: 'audio-audition', status: 'unsupported', reason: 'isolated-render-unavailable' },
            ]);
        });
    });

    describe('device graph adapter', () => {
        it('compiles the projected routing and device topology', () => {
            expect(previewDeviceGraph({ actions: [addDevice], projectDocument: createProjectedDocument() })).toEqual({
                status: 'previewed',
                domain: 'device-graph',
                schemaVersion: 1,
                handle: { edgeCount: 5, nodeIds: ['bus-a', 'master', 'track-1'] },
            });
        });

        it('reports a projected topology that does not compile', () => {
            const document = createProjectedDocument();
            const tracks = (document.tracks as { tracks: { id: string; outputId: string }[] }).tracks;
            tracks[2]!.outputId = 'bus-missing';

            expect(previewDeviceGraph({ actions: [addDevice], projectDocument: document })).toEqual({
                status: 'unsupported',
                domain: 'device-graph',
                reason: 'graph-invalid',
            });
        });

        it('reports a document that carries no tracks slot', () => {
            expect(previewDeviceGraph({ actions: [addDevice], projectDocument: {} })).toEqual({
                status: 'unsupported',
                domain: 'device-graph',
                reason: 'projection-slot-missing',
            });
        });
    });

    describe('automation curve adapter', () => {
        it('reports the named lane breakpoints in beat order', () => {
            expect(
                previewAutomationCurve({
                    actions: [addAutomationPoint],
                    projectDocument: createProjectedDocument(),
                })
            ).toEqual({
                status: 'previewed',
                domain: 'automation-curve',
                schemaVersion: 1,
                handle: [
                    {
                        laneId: 'lane-1',
                        points: [
                            { beat: 0, value: 0.1 },
                            { beat: 2, value: 0.5 },
                            { beat: 4, value: 0.9 },
                        ],
                    },
                ],
            });
        });

        it('reports a document that carries no automation slot', () => {
            expect(previewAutomationCurve({ actions: [addAutomationPoint], projectDocument: {} })).toEqual({
                status: 'unsupported',
                domain: 'automation-curve',
                reason: 'projection-slot-missing',
            });
        });
    });

    describe('midi overlay adapter', () => {
        it('reports the projected notes of the clips the batch names and no others', () => {
            expect(previewMidiOverlay({ actions: [addNotes], projectDocument: createProjectedDocument() })).toEqual({
                status: 'previewed',
                domain: 'midi-overlay',
                schemaVersion: 1,
                handle: [
                    {
                        clipId: 'clip-1',
                        notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                    },
                ],
            });
        });

        it('reports a document that carries no midi slot', () => {
            expect(previewMidiOverlay({ actions: [addNotes], projectDocument: {} })).toEqual({
                status: 'unsupported',
                domain: 'midi-overlay',
                reason: 'projection-slot-missing',
            });
        });
    });

    describe('audio audition adapter', () => {
        it('reports the cached buffer figures of the audio the batch would place', () => {
            vi.mocked(getCachedAudioBuffer).mockReturnValue(cachedBuffer());

            expect(
                previewAudioAudition({ actions: [addAudioClip], projectDocument: createProjectedDocument() })
            ).toEqual({
                status: 'previewed',
                domain: 'audio-audition',
                schemaVersion: 1,
                handle: [{ audioBufferId: 'buffer-1', durationSeconds: 2.5, sampleRate: 48000, channelCount: 2 }],
            });
        });
    });

    describe('aggregate', () => {
        it('returns the unsupported reason for a domain instead of running its adapter', () => {
            expect(
                buildAgentDomainPreviews({
                    actions: [generateBassline, addDevice],
                    projectDocument: createProjectedDocument(),
                })
            ).toEqual([
                { status: 'unsupported', domain: 'midi-overlay', reason: 'external-execution' },
                {
                    status: 'previewed',
                    domain: 'device-graph',
                    schemaVersion: 1,
                    handle: { edgeCount: 5, nodeIds: ['bus-a', 'master', 'track-1'] },
                },
            ]);
        });
    });

    describe('risk policy escalation', () => {
        it('confirms an allowed operation whose preview is unsupported without raising its trust mode', () => {
            const allowed = getAgentActionRiskPolicy({ operationTypes: ['addDevice'] });
            const unpreviewable = getAgentActionRiskPolicy({
                operationTypes: ['addDevice'],
                signals: { unsupportedPreviewDomains: ['audio-audition'] },
            });

            expect(allowed.decision).toBe('allow');
            expect(unpreviewable.decision).toBe('confirm');
            expect(unpreviewable.reasons).toContain(
                'Preview is unsupported for audio-audition; explicit acceptance is required.'
            );
            expect(unpreviewable.requiredTrustMode).toBe(allowed.requiredTrustMode);
            expect(unpreviewable.risk).toBe(allowed.risk);
        });
    });

    describe('auto-commit gate', () => {
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
                    id: 'track-1',
                    name: 'Lead',
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
                        { id: 'clip-1', name: 'Loop', type: 'audio' as const, startBeat: 0, endBeat: 4, noteCount: 0 },
                    ],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-1',
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1'],
            activeView: 'arrange' as const,
            playheadPosition: 0,
        };

        function compile(action: AppAction, mode: 'apply' | 'preview') {
            return compileAgentActionExecution({
                actions: [action],
                actionLabels: ['Preview gate action'],
                context,
                group: { groupId: 'group-preview-gate', groupLabel: 'Preview gate' },
                intent: 'Exercise the preview gate',
                mode,
                projectRevision: captureProjectRevision(),
                requiresConfirmation: false,
                runId: 'run-preview-gate',
            });
        }

        function autoCommits(commandBatch: { serialized: string; authority: unknown }): boolean {
            const parsed = parseVersionedCommandBatchEnvelope(
                commandBatch.serialized,
                commandBatch.authority as Parameters<typeof parseVersionedCommandBatchEnvelope>[1]
            );
            if (parsed.status === 'invalid') {
                throw new Error(parsed.reason);
            }
            return parsed.envelope.grants.autoCommit;
        }

        beforeEach(() => {
            configureAiWorkflowCommandCheckpointRuntime();
            collaborationStore.set({ ...baseCollaborationState, localPeerId: 'actor-a' });
            commandBatchPreflightPort.setProvider(({ targetIds }) => ({
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: captureProjectIdentity(),
                projectInvariantsValid: true,
                targetFingerprints: Object.fromEntries(targetIds.map((targetId) => [targetId, `${targetId}:v1`])),
            }));
        });

        afterEach(() => {
            resetAiWorkflowCommandCheckpointRuntime();
            commandBatchPreflightPort.setProvider(null);
            collaborationStore.set(structuredClone(baseCollaborationState));
        });

        it('escalates an allowed batch whose preview domain is unsupported to explicit confirmation', () => {
            const compiled = compile(trimClipEnd, 'apply');

            expect(compiled.requiresConfirmation).toBe(true);
            expect(compiled.allowApproval).toBeNull();
            expect(autoCommits(compiled.commandBatch)).toBe(false);
        });

        it('leaves an allowed batch whose preview domain is supported on the auto-commit path', () => {
            const compiled = compile(addDevice, 'apply');

            expect(compiled.requiresConfirmation).toBe(false);
            expect(compiled.allowApproval).not.toBeNull();
            expect(autoCommits(compiled.commandBatch)).toBe(true);
        });

        it('leaves preview mode unconfirmed when a domain preview is unsupported', () => {
            const compiled = compile(trimClipEnd, 'preview');

            expect(compiled.requiresConfirmation).toBe(false);
            expect(compiled.interactionMode).toBe('preview');
        });
    });
});
