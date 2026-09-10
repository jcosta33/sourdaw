import { describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../../models/ProjectContext';
import { createGroundingAdmissionStrategyRegistry } from '../createGroundingAdmissionStrategyRegistry';
import {
    resolveWorkflowShortcutScope,
    workflowShortcutScopeActionNames,
    workflowShortcutScopeStrategyDefinitions,
    type WorkflowShortcutScopeActionName,
    type WorkflowShortcutScopeInput,
} from '../workflowShortcutScopeStrategy';

const articulationMocks = vi.hoisted(() => ({
    getArticulationTransferPromptScope: vi.fn(),
}));

vi.mock('../../getArticulationTransferPromptScope', () => ({
    getArticulationTransferPromptScope: articulationMocks.getArticulationTransferPromptScope,
}));

function track(overrides: Partial<ProjectContextTrack> & { id: string; name: string }): ProjectContextTrack {
    return {
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
        ...overrides,
    };
}

function context(tracks: ProjectContextTrack[]): ProjectContext {
    return {
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
        masterGain: 0.8,
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

const drumRoutingContext = context([
    track({ id: 'bus-drum', name: 'Drum Bus', kind: 'bus' }),
    track({ id: 'bus-parallel', name: 'Parallel Compression', kind: 'bus' }),
    track({ id: 'track-kick', name: 'Kick', outputId: 'master' }),
    track({ id: 'track-snare', name: 'Snare', outputId: 'master' }),
]);

const drumRoutingArguments = [
    { trackId: 'track-kick', outputId: 'bus-drum' },
    { trackId: 'track-snare', outputId: 'bus-drum' },
];

const SIDECHAIN_PROMPT = 'reduce kick bass masking without replacing either basic sound';

const sidechainContext = context([
    track({ id: 'track-kick', name: 'Kick' }),
    track({
        id: 'track-bass',
        name: 'Bass',
        deviceCount: 1,
        devices: [{ id: 'device-sidechain', name: 'Sidechain', type: 'builtin-sidechain-compressor', bypassed: false }],
    }),
]);

const sidechainArguments = [
    { sourceTrackId: 'track-kick', targetTrackId: 'track-bass', targetDeviceId: 'device-sidechain' },
];

const articulationRequestScope = {
    status: 'request' as const,
    clipPairs: [
        { sourceClipId: 'clip-chorus-one', targetClipId: 'clip-chorus-two' },
        { sourceClipId: 'clip-lead-one', targetClipId: 'clip-lead-two' },
    ],
    protectedClipIds: [],
};

const articulationArguments = [
    { sourceClipId: 'clip-chorus-one', targetClipId: 'clip-chorus-two' },
    { sourceClipId: 'clip-lead-one', targetClipId: 'clip-lead-two' },
];

function resolve(overrides: Partial<WorkflowShortcutScopeInput> & { actionName: string }) {
    return resolveWorkflowShortcutScope({
        context: context([]),
        prompt: 'do the thing',
        sameActionAssertedArguments: [],
        sameActionCallCount: 0,
        ...overrides,
    });
}

describe('workflow shortcut scope strategies', () => {
    it('registers exactly the workflow shortcut action names', () => {
        const registry = createGroundingAdmissionStrategyRegistry<
            WorkflowShortcutScopeActionName,
            Omit<WorkflowShortcutScopeInput, 'actionName'>,
            ReturnType<typeof resolveWorkflowShortcutScope>
        >(
            'workflow shortcut scope',
            workflowShortcutScopeStrategyDefinitions,
            getExecutableAppActionGroundingCatalog(),
            workflowShortcutScopeActionNames
        );

        expect([...registry.keys()]).toEqual([...workflowShortcutScopeActionNames]);
    });

    it('leaves an action without a workflow shortcut strategy unchanged', () => {
        expect(
            resolve({
                actionName: 'muteTrack',
                context: drumRoutingContext,
                sameActionAssertedArguments: drumRoutingArguments,
                sameActionCallCount: 2,
                workflowCapabilityId: 'drum-routing',
            })
        ).toBe(null);
    });

    it('scopes a drum-routing output change to the whole request', () => {
        expect(
            resolve({
                actionName: 'setTrackOutput',
                context: drumRoutingContext,
                prompt: 'route the drums into the drum bus',
                sameActionAssertedArguments: drumRoutingArguments,
                sameActionCallCount: 2,
                workflowCapabilityId: 'drum-routing',
            })
        ).toEqual({
            text: 'route the drums into the drum bus',
            masked: 'route the drums into the drum bus',
            directional: false,
            matchedIntentPhrase: 'route',
        });
    });

    it('falls through an output change outside the drum-routing capability', () => {
        expect(
            resolve({
                actionName: 'setTrackOutput',
                context: drumRoutingContext,
                prompt: 'route the drums into the drum bus',
                sameActionAssertedArguments: drumRoutingArguments,
                sameActionCallCount: 2,
            })
        ).toBe(null);
    });

    it('scopes an articulation transfer to the whole request', () => {
        articulationMocks.getArticulationTransferPromptScope.mockReturnValue(articulationRequestScope);

        expect(
            resolve({
                actionName: 'copyMidiArticulations',
                prompt: 'copy chorus one articulation to chorus two',
                sameActionAssertedArguments: articulationArguments,
                sameActionCallCount: 2,
                workflowCapabilityId: 'articulation-transfer',
            })
        ).toEqual({
            text: 'copy chorus one articulation to chorus two',
            masked: 'copy chorus one articulation to chorus two',
            directional: false,
            matchedIntentPhrase: 'copy articulation',
        });
    });

    it('falls through an articulation transfer whose call count misses the pair count', () => {
        articulationMocks.getArticulationTransferPromptScope.mockReturnValue(articulationRequestScope);

        expect(
            resolve({
                actionName: 'copyMidiArticulations',
                prompt: 'copy chorus one articulation to chorus two',
                sameActionAssertedArguments: articulationArguments.slice(0, 1),
                sameActionCallCount: 1,
                workflowCapabilityId: 'articulation-transfer',
            })
        ).toBe(null);
    });

    it('scopes a sidechain routing request to the whole request', () => {
        expect(
            resolve({
                actionName: 'addSidechainRoute',
                context: sidechainContext,
                prompt: SIDECHAIN_PROMPT,
                sameActionAssertedArguments: sidechainArguments,
                sameActionCallCount: 1,
            })
        ).toEqual({
            text: SIDECHAIN_PROMPT,
            masked: SIDECHAIN_PROMPT,
            directional: false,
            matchedIntentPhrase: 'create sidechain',
        });
    });

    it('falls through a sidechain routing request whose call count misses the route count', () => {
        expect(
            resolve({
                actionName: 'addSidechainRoute',
                context: sidechainContext,
                prompt: SIDECHAIN_PROMPT,
                sameActionAssertedArguments: sidechainArguments,
                sameActionCallCount: 2,
            })
        ).toBe(null);
    });
});
