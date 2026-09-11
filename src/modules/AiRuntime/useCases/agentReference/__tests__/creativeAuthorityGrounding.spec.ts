import { describe, expect, it } from 'vitest';

import { type CreativeRequestAuthority } from '../../../models/CreativeInterpretation';
import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { compileArbitraryCommandList } from '../../compileArbitraryCommandList';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

const RADIO_PROMPT = 'make it sound like a radio';

/** Names a direction for the gain and no figure for it, which is what the creative route decides. */
const QUIETER_RADIO_PROMPT = 'make the Guitar quieter and more distant, like an old radio';

const guitarTrack: ProjectContextTrack = {
    id: 'guitar',
    name: 'Guitar',
    kind: 'audio',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: 1,
    deviceCount: 1,
    clips: [{ id: 'guitar-clip-1', name: 'Guitar Take', type: 'audio', startBeat: 0, endBeat: 16, noteCount: 0 }],
    devices: [
        {
            id: 'guitar-eq-1',
            type: 'eq',
            bypassed: false,
            parameters: [
                { id: 'gain', name: 'Gain', type: 'float', value: 0, minValue: -12, maxValue: 12, unit: 'dB' },
            ],
        },
    ],
};

const bassTrack: ProjectContextTrack = {
    id: 'bass',
    name: 'Bass',
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
};

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
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    availableDeviceTypes: [
        { id: 'radio-filter', name: 'Radio Filter' },
        { id: 'compressor', name: 'Compressor' },
    ],
    tracks: [guitarTrack, bassTrack],
    selectedTrackId: 'guitar',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

/**
 * Two published device types share one display name, so a provider naming that name matches several
 * and the creative acceptance defers to the ordinary rule that refuses it.
 */
const ambiguousDeviceTypeContext: ProjectContext = {
    ...context,
    availableDeviceTypes: [
        { id: 'radio-filter', name: 'Radio Filter' },
        { id: 'radio-filter-vintage', name: 'Radio Filter' },
    ],
};

/** A brightness parameter with a baseline, so a stated direction has something to move away from. */
const brightnessContext: ProjectContext = {
    ...context,
    tracks: [
        {
            ...guitarTrack,
            deviceCount: 2,
            devices: [
                ...guitarTrack.devices,
                {
                    id: 'guitar-filter-1',
                    type: 'filter',
                    bypassed: false,
                    parameters: [
                        {
                            id: 'brightness',
                            name: 'Brightness',
                            type: 'float',
                            value: 0.6,
                            minValue: 0,
                            maxValue: 1,
                            unit: '',
                        },
                    ],
                },
            ],
        },
        bassTrack,
    ],
};

function buildAuthority(overrides: Partial<CreativeRequestAuthority> = {}): CreativeRequestAuthority {
    return {
        schemaVersion: 1,
        authorityId: 'creative-authority-1',
        catalogId: 'creative-catalog-1',
        requestDigest: 'request-digest-1',
        revision: 'revision-1',
        selection: { trackId: 'guitar', clipId: null, clipIds: [], activeView: 'arrange' },
        mode: 'edit',
        targets: [
            {
                provenance: 'contextual-selection',
                objectType: 'track',
                objectIds: ['guitar'],
                parentTrackId: null,
            },
        ],
        editDimensions: ['processing'],
        prohibitions: [],
        creationSlots: [{ objectType: 'device', parentObjectId: 'guitar', budget: 4 }],
        uncertainty: 'none',
        ...overrides,
    };
}

function bridge(input: {
    calls: readonly ToolCallResult[];
    creativeAuthority?: CreativeRequestAuthority;
    projectContext?: ProjectContext;
    prompt?: string;
}) {
    return bridgeGroundedLlmToolCalls({
        calls: input.calls,
        context: input.projectContext ?? context,
        prompt: input.prompt ?? RADIO_PROMPT,
        ...(input.creativeAuthority === undefined ? {} : { creativeAuthority: input.creativeAuthority }),
    });
}

const VALUE_MISMATCH_REASON = 'Provider value value does not match the user request';

function bridgeBrightness(prompt: string, value: number) {
    return bridge({
        calls: [
            { name: 'setDeviceParameter', arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value } },
        ],
        creativeAuthority: buildAuthority(),
        projectContext: brightnessContext,
        prompt,
    });
}

function expectBrightnessGrounded(prompt: string, value: number): void {
    const result = bridgeBrightness(prompt, value);

    expect(result.rejections).toEqual([]);
    expect(result.actions).toMatchObject([
        { type: 'setDeviceParameter', payload: { deviceId: 'guitar-filter-1', paramId: 'brightness', value } },
    ]);
}

function expectBrightnessRejected(prompt: string, value: number): void {
    const result = bridgeBrightness(prompt, value);

    expect(result.actions).toEqual([]);
    expect(result.rejections).toMatchObject([{ name: 'setDeviceParameter', reason: VALUE_MISMATCH_REASON }]);
}

const addRadioFilter: ToolCallResult = {
    name: 'addDevice',
    arguments: { trackId: 'guitar', deviceType: 'radio-filter' },
};

/** A request whose creation evidence opens the plan-created object route for the whole batch. */
const BAND_PROMPT = 'create a blues song with a full band';

const PROJECT_REVISION = 'revision-1';

/** The slot the interpretation catalog publishes for tracks a batch creates under its own authority. */
const TRACK_CREATION_SLOT = { objectType: 'track', parentObjectId: null, budget: 4 } as const;

/** What the authority answers to a command that rearranges a project it was admitted to process. */
const ARRANGEMENT_REFUSAL_REASON = 'Creative authority does not cover the arrangement edit dimension';

/** A plan carrying the objective and scope the compiler needs before it emits bridge evidence. */
const bandPlan = {
    semantic: { classification: 'complex', uncertainty: [] },
    objective: 'Lay out the tracks a full band needs, all of them created by this batch.',
    constraints: ['Leave every object the project already holds unchanged.'],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: ['Validate that every created track carries the name its item declared.'],
    stoppingConditions: ['Stop if a track cannot be created.'],
};

const BAND_TRACK_NAMES = ['Blues Drums', 'Blues Bass', 'Blues Rhythm', 'Blues Lead', 'Blues Keys'];

/** Bound `addTrack` items with distinct names, which is what the plan-created route admits. */
function addTrackItems(count: number): Record<string, unknown>[] {
    return BAND_TRACK_NAMES.slice(0, count).map((name, index) => ({
        id: `make-${String(index)}`,
        name: 'addTrack',
        arguments: { name, kind: 'midi', binding: `band-${String(index)}` },
    }));
}

/**
 * Compiles a bound-creation proposal under a create-mode authority and grounds it, so the batch the
 * bridge reads is the one the compiler actually produced for that authority rather than a hand-built
 * command list the evidence would refuse.
 */
function bridgeBandProposal(input: { creationSlots: CreativeRequestAuthority['creationSlots']; itemCount: number }) {
    const creativeAuthority = buildAuthority({
        mode: 'create',
        targets: [],
        creationSlots: input.creationSlots,
    });
    const compiled = compileArbitraryCommandList({
        calls: [
            {
                name: 'command.batch.propose',
                arguments: { plan: bandPlan, list: { schemaVersion: 1, items: addTrackItems(input.itemCount) } },
            },
        ],
        context,
        creativeAuthority,
        revision: PROJECT_REVISION,
    });
    if (compiled.status === 'rejected') {
        throw new TypeError(compiled.reason);
    }
    if (compiled.compilerEvidence === undefined) {
        throw new TypeError('Expected the compiled proposal to carry bridge evidence');
    }
    return bridgeGroundedLlmToolCalls({
        calls: compiled.compilerEvidence.commands,
        compilerEvidence: compiled.compilerEvidence,
        context,
        creativeAuthority,
        projectRevision: PROJECT_REVISION,
        prompt: BAND_PROMPT,
    });
}

describe('creative authority grounding in the tool-call bridge', () => {
    it('refuses a device the request never named when the run carries no authority', () => {
        const result = bridge({ calls: [addRadioFilter] });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('grounds the same device once the admitted authority covers the track and the dimension', () => {
        const result = bridge({ calls: [addRadioFilter], creativeAuthority: buildAuthority() });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'addDevice', payload: { trackId: 'guitar', deviceType: 'radio-filter' } },
        ]);
    });

    it('refuses the same device when the request withdrew the change it described', () => {
        const result = bridge({
            calls: [addRadioFilter],
            creativeAuthority: buildAuthority(),
            prompt: "add something that makes the Guitar sound like a radio, but don't apply the change",
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses the same device when the request withdrew the change without naming this command', () => {
        const result = bridge({
            calls: [addRadioFilter],
            creativeAuthority: buildAuthority(),
            prompt: 'make it sound like a radio, but never mind, leave it unchanged',
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses the same device when the request phrased this command negatively', () => {
        const result = bridge({
            calls: [addRadioFilter],
            creativeAuthority: buildAuthority(),
            prompt: "make it sound like a radio, but don't add any devices",
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses a gain that contradicts the direction the request stated without a number', () => {
        const result = bridge({
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 1 } }],
            creativeAuthority: buildAuthority(),
            prompt: QUIETER_RADIO_PROMPT,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider value gain does not match the user request' },
        ]);
    });

    it('refuses a clip gain the ordinary route requires the request to state a number for', () => {
        const result = bridge({
            calls: [{ name: 'setClipGain', arguments: { clipId: 'guitar-clip-1', gain: 0.5 } }],
            prompt: 'set Guitar Take clip volume to taste',
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setClipGain', reason: 'Provider value gain does not match the user request' },
        ]);
    });

    it('grounds that same clip gain once the admitted authority covers the clip', () => {
        const result = bridge({
            calls: [{ name: 'setClipGain', arguments: { clipId: 'guitar-clip-1', gain: 0.5 } }],
            creativeAuthority: buildAuthority(),
            prompt: 'set Guitar Take clip volume to taste',
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'setClipGain', payload: { clipId: 'guitar-clip-1', gain: 0.5 } },
        ]);
    });

    it('grounds a parameter value the request never stated', () => {
        const result = bridge({
            calls: [{ name: 'setDeviceParameter', arguments: { deviceId: 'guitar-eq-1', paramId: 'gain', value: 4 } }],
            creativeAuthority: buildAuthority(),
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: 'guitar-eq-1', paramId: 'gain', value: 4 } },
        ]);
    });

    it('refuses a parameter value that moves against the direction the request stated for that parameter', () => {
        const result = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'make it darker, lower the brightness and boost the gain',
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setDeviceParameter', reason: 'Provider value value does not match the user request' },
        ]);
    });

    it('grounds a parameter value that obeys the direction stated for that parameter, ignoring a direction stated for another', () => {
        const withoutAuthority = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 },
                },
            ],
            projectContext: brightnessContext,
            prompt: 'make it darker, lower the brightness and boost the gain',
        });

        expect(withoutAuthority.actions).toEqual([]);

        const result = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'make it darker, lower the brightness and boost the gain',
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 } },
        ]);
    });

    it('reads a direction from a clause naming nothing that follows the clause naming the device', () => {
        const rejected = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'the filter is too much, turn down',
        });

        expect(rejected.actions).toEqual([]);
        expect(rejected.rejections).toMatchObject([
            { name: 'setDeviceParameter', reason: 'Provider value value does not match the user request' },
        ]);

        const grounded = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'the filter is too much, turn down',
        });

        expect(grounded.rejections).toEqual([]);
        expect(grounded.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 } },
        ]);
    });

    it('refuses both directions when the whole scope states an increase and a decrease and names neither target', () => {
        const higher = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'turn up a little, no wait, turn down',
        });

        expect(higher.actions).toEqual([]);
        expect(higher.rejections).toMatchObject([
            { name: 'setDeviceParameter', reason: 'Provider value value does not match the user request' },
        ]);

        const lower = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'turn up a little, no wait, turn down',
        });

        expect(lower.actions).toEqual([]);
        expect(lower.rejections).toMatchObject([
            { name: 'setDeviceParameter', reason: 'Provider value value does not match the user request' },
        ]);
    });

    it('reads a decrease from a clause naming only the device when no clause names the parameter', () => {
        const rejected = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'the filter is too bright, lower it',
        });

        expect(rejected.actions).toEqual([]);
        expect(rejected.rejections).toMatchObject([
            { name: 'setDeviceParameter', reason: 'Provider value value does not match the user request' },
        ]);

        const grounded = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'the filter is too bright, lower it',
        });

        expect(grounded.rejections).toEqual([]);
        expect(grounded.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 } },
        ]);
    });

    it('reads a decrease from the ordinary "turn it down" phrasing', () => {
        const rejected = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'the filter is too much, turn it down',
        });

        expect(rejected.actions).toEqual([]);
        expect(rejected.rejections).toMatchObject([
            { name: 'setDeviceParameter', reason: 'Provider value value does not match the user request' },
        ]);

        const grounded = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'the filter is too much, turn it down',
        });

        expect(grounded.rejections).toEqual([]);
        expect(grounded.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.3 } },
        ]);
    });

    it('reads a decrease from the "turn ... down" phrasing across the parameter it names', () => {
        const prompt = 'turn the brightness down';

        expectBrightnessRejected(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('reads an increase from the "turn ... up" phrasing across the device and parameter it names', () => {
        const prompt = 'turn the filter brightness up a little';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessRejected(prompt, 0.3);
    });

    it('ignores a direction stated in a clause naming another parameter', () => {
        const prompt = 'the filter needs work, and lower the gain';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('keeps an anaphoric direction with the object its preceding clause named', () => {
        const prompt = 'the eq is harsh, turn it down, and give the filter some sparkle';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('reads an increase from a clause naming this device, ignoring a decrease stated for another track', () => {
        const prompt = 'lower the bass, and turn the filter up a touch';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessRejected(prompt, 0.3);
    });

    it('attributes a later clause naming this device back to it after a clause naming another device', () => {
        const prompt = 'the eq is harsh, turn it down, and the filter is dull, turn it up';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessRejected(prompt, 0.3);
    });

    it('reads an increase from a clause naming nothing that follows the clause naming the device', () => {
        const prompt = 'the filter is dull, turn it up';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessRejected(prompt, 0.3);
    });

    it('attributes a clause naming both this device and another device to this device', () => {
        const prompt = 'lower the filter more than the eq';

        expectBrightnessRejected(prompt, 0.9);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('attributes a clause naming this device owner track over another track it also names', () => {
        const prompt = 'the guitar is too bright compared to the bass, turn it down';

        expectBrightnessRejected(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('attributes a clause naming another device over the owner track it also names', () => {
        const prompt = 'lower the guitar eq, and raise the brightness';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessRejected(prompt, 0.3);
    });

    it('attributes a clause naming this device by id', () => {
        const prompt = 'turn guitar-filter-1 down';

        expectBrightnessRejected(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('reads a direction from a clause naming this parameter even after a clause naming another one', () => {
        const prompt = 'lower the gain, and raise the brightness';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessRejected(prompt, 0.3);
    });

    it('does not bind the "turn" direction to a particle from a trailing purpose clause', () => {
        const prompt = 'the filter is too much, turn it down to clean up the mix';

        expectBrightnessRejected(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('states no direction when the only "up"/"down" token sits past a "to" purpose clause', () => {
        const prompt = 'turn it on to warm up the mix';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it("stops the turn direction gap at a particle, not a later phrasal verb's particle", () => {
        const prompt = 'turn it down while building up the mix';

        expectBrightnessRejected(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('states no direction when the gap cap stops the reach to a distant "up" token', () => {
        const prompt = 'turn it on while the mix opens up';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessGrounded(prompt, 0.3);
    });

    it('reads an increase from the "boost" phrase', () => {
        const prompt = 'boost the brightness';

        expectBrightnessGrounded(prompt, 0.8);
        expectBrightnessRejected(prompt, 0.3);
    });

    it('grounds a bypass intent the request never phrased', () => {
        const result = bridge({
            calls: [{ name: 'bypassDevice', arguments: { deviceId: 'guitar-eq-1', bypassed: true } }],
            creativeAuthority: buildAuthority(),
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'bypassDevice', payload: { deviceId: 'guitar-eq-1', bypassed: true } },
        ]);
    });

    it('still refuses a value that contradicts a number the request stated', () => {
        const result = bridge({
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 0.3 } }],
            creativeAuthority: buildAuthority(),
            prompt: `${RADIO_PROMPT} at 0.5`,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider value gain does not match the user request' },
        ]);
    });

    it('grounds the value the request stated', () => {
        const result = bridge({
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 0.5 } }],
            creativeAuthority: buildAuthority(),
            prompt: `${RADIO_PROMPT} at 0.5`,
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([{ type: 'setTrackGain', payload: { trackId: 'guitar', gain: 0.5 } }]);
    });

    it('refuses a device type that matches several published types', () => {
        const result = bridge({
            calls: [{ name: 'addDevice', arguments: { trackId: 'guitar', deviceType: 'Radio Filter' } }],
            creativeAuthority: buildAuthority(),
            projectContext: ambiguousDeviceTypeContext,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider value deviceType does not match the user request' },
        ]);
    });

    it('refuses a call on a track the admitted authority does not name', () => {
        const result = bridge({
            calls: [addRadioFilter],
            creativeAuthority: buildAuthority({
                targets: [
                    {
                        provenance: 'contextual-selection',
                        objectType: 'track',
                        objectIds: ['bass'],
                        parentTrackId: null,
                    },
                ],
                creationSlots: [{ objectType: 'device', parentObjectId: 'bass', budget: 4 }],
            }),
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections[0]?.reason).toMatch(/^Creative authority /u);
    });

    it('grounds every plan-created track inside the budget the authority published', () => {
        const result = bridgeBandProposal({ creationSlots: [TRACK_CREATION_SLOT], itemCount: 4 });

        expect(result.rejections).toEqual([]);
        expect(result.actions.map((action) => action.type)).toEqual(['addTrack', 'addTrack', 'addTrack', 'addTrack']);
    });

    /**
     * The batch declares batch-local bindings, so one refusal takes the whole proposal down rather
     * than committing the four tracks that fit and dropping the fifth on the musician's behalf.
     */
    it('refuses the plan-created track past the published budget and the batch that carried it', () => {
        const result = bridgeBandProposal({ creationSlots: [TRACK_CREATION_SLOT], itemCount: 5 });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { index: 4, name: 'addTrack', reason: 'Creative authority has spent its track creation budget of 4' },
        ]);
    });

    it('refuses every plan-created track when the authority published no track creation slot', () => {
        const result = bridgeBandProposal({
            creationSlots: [{ objectType: 'device', parentObjectId: 'guitar', budget: 4 }],
            itemCount: 3,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { index: 0, name: 'addTrack', reason: ARRANGEMENT_REFUSAL_REASON },
            { index: 1, name: 'addTrack', reason: ARRANGEMENT_REFUSAL_REASON },
            { index: 2, name: 'addTrack', reason: ARRANGEMENT_REFUSAL_REASON },
        ]);
    });

    it('leaves a creative call standing when a cue in the same prompt withdraws a different planned action', () => {
        const result = bridge({
            calls: [addRadioFilter, { name: 'muteTrack', arguments: { trackId: 'bass' } }],
            creativeAuthority: buildAuthority(),
            prompt: 'make it sound like a radio, mute the bass, actually never mind the mute',
        });

        expect(result.actions).toMatchObject([
            { type: 'addDevice', payload: { trackId: 'guitar', deviceType: 'radio-filter' } },
        ]);
        expect(result.rejections).toMatchObject([
            { name: 'muteTrack', reason: 'Creative authority does not extend to monitoring effects' },
        ]);
    });

    it('grounds setDeviceParameter on brightness when a negated word contains an intent verb as a substring', () => {
        const result = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'do not touch the preset, set the brightness to 0.8',
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 } },
        ]);
    });

    it('refuses setDeviceParameter when the prompt explicitly negates that intent', () => {
        const result = bridge({
            calls: [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'guitar-filter-1', paramId: 'brightness', value: 0.8 },
                },
            ],
            creativeAuthority: buildAuthority(),
            projectContext: brightnessContext,
            prompt: 'do not set the brightness',
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setDeviceParameter', reason: 'Provider action is not grounded in the user request' },
        ]);
    });
});
