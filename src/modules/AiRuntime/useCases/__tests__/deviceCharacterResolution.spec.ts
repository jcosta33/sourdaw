import { describe, expect, it } from 'vitest';

import { getPlatformPlugins, getPluginById, isReverbDeviceType } from '#/modules/Arrangement/useCases';
import { getDeviceChainTailSeconds } from '#/modules/AudioEngine/useCases';
import { queryAgentDiscovery } from '#/modules/Project/useCases';
import { createPunchRegionPatch } from '#/modules/Transport/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { bridgeLlmToolCalls } from '../../transformers/llmActionBridge';
import { getBackingVocalPlatePromptScope } from '../agentReference/getBackingVocalPlatePromptScope';
import { getProjectContext } from '../getProjectContext';

function receiptItems(domain: 'device' | 'preset', character: string) {
    const result = queryAgentDiscovery({ domain, filters: { text: character }, page: { limit: 50 } });
    if (result.status !== 'receipt') {
        throw new Error(`Expected ${domain} discovery receipt for ${character}.`);
    }
    return result.receipt.items;
}

type Descriptor = NonNullable<ReturnType<typeof getPluginById>>;
type DescriptorChange = Partial<Pick<Descriptor, 'characterTags' | 'name' | 'platform'>>;
type PlateRequest = Extract<ReturnType<typeof getBackingVocalPlatePromptScope>, { status: 'request' }>;

const FORMER_REVERB_DEVICE_TYPES = [
    'builtin-convolution-reverb',
    'builtin-reverb',
    'dutch-oven',
    'faust-spring-reverb',
    'faust-zita-rev1-reverb',
    'proof-chamber',
];
const NO_PLATE_DEVICE_REFUSAL = {
    status: 'invalid',
    reason: 'EX-01 requires an available plate reverb: no available device declares the plate character',
};

function requireDescriptor(deviceType: string): Descriptor {
    const descriptor = getPluginById(deviceType);
    if (!descriptor) {
        throw new Error(`Expected the ${deviceType} descriptor.`);
    }
    return descriptor;
}

/** Changes shipped descriptors for the length of `body`, restoring each field afterwards. */
function withDescriptorChanges(
    changes: ReadonlyArray<readonly [deviceType: string, change: DescriptorChange]>,
    body: () => void
): void {
    const [first, ...rest] = changes;
    if (first === undefined) {
        body();
        return;
    }
    const [deviceType, change] = first;
    const descriptor = requireDescriptor(deviceType);
    const originals = Object.fromEntries(Object.keys(change).map((key) => [key, Reflect.get(descriptor, key)]));
    Object.assign(descriptor, change);
    try {
        withDescriptorChanges(rest, body);
    } finally {
        Object.assign(descriptor, originals);
    }
}

function createVocalTrack(id: string, name: string, devices: ProjectContextTrack['devices'] = []): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: devices.length,
        clips: [],
        devices,
    };
}

function platformDeviceCatalogue(): NonNullable<ProjectContext['availableDeviceTypes']> {
    return getPlatformPlugins().map(({ id, name }) => ({ id, name }));
}

function createPlateProjectContext({
    availableDeviceTypes = platformDeviceCatalogue(),
    backingVocalDevices = [{ id: 'device-bgv-reverb', type: 'builtin-reverb', bypassed: false }],
}: {
    availableDeviceTypes?: ProjectContext['availableDeviceTypes'];
    backingVocalDevices?: ProjectContextTrack['devices'];
} = {}): ProjectContext {
    return {
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
        availableDeviceTypes,
        sections: [{ id: 'section-chorus', name: 'Chorus', startBeat: 32, endBeat: 48 }],
        tracks: [
            createVocalTrack('track-lead', 'Lead Vocal'),
            createVocalTrack('track-bgv', 'Backing Vocal', backingVocalDevices),
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

function requestPlateScope(context: ProjectContext): PlateRequest {
    const scope = getBackingVocalPlatePromptScope(context);
    if (scope.status !== 'request') {
        throw new Error(`Expected a plate request scope, got: ${scope.reason}`);
    }
    return scope;
}

function addedDeviceTypes(scope: PlateRequest): unknown[] {
    return scope.capability.orderedToolPlan
        .filter((call) => call.name === 'addDevice')
        .map((call) => call.arguments.deviceType);
}

/** The render tail the descriptor itself declares at its default settings, read without the scope. */
function declaredTailSeconds(deviceType: string): number {
    const descriptor = requireDescriptor(deviceType);
    return getDeviceChainTailSeconds({
        devices: [
            {
                id: 'tail-probe',
                type: deviceType,
                parameterValues: Object.fromEntries(
                    descriptor.parameters.map((parameter) => [parameter.id, parameter.defaultValue])
                ),
                bypassed: false,
            },
        ],
        tailForDeviceType: (type) => getPluginById(type)?.tail,
    }).seconds;
}

describe('device character discovery', () => {
    it.each([
        { character: 'plate', deviceId: 'dutch-oven', presetId: 'fx-rev-plate' },
        { character: 'hall', deviceId: null, presetId: 'fx-rev-large-hall' },
        { character: 'room', deviceId: null, presetId: 'fx-rev-small-room' },
        { character: 'spring', deviceId: 'faust-spring-reverb', presetId: 'fx-rev-spring' },
        { character: 'tape', deviceId: 'faust-tape-delay', presetId: 'factory-faust-tape-slapback' },
        { character: 'tube', deviceId: null, presetId: 'fx-dist-warm-overdrive' },
        { character: 'bitcrush', deviceId: 'builtin-bitcrusher', presetId: 'fx-lofi-vinyl' },
    ])('resolves $character from owner metadata', ({ character, deviceId, presetId }) => {
        const devices = receiptItems('device', character);
        const presets = receiptItems('preset', character);

        expect(presets.some((item) => item.id === presetId)).toBe(true);
        if (deviceId === null) {
            expect(devices).toEqual([]);
            return;
        }
        expect(devices.find((item) => item.id === deviceId)).toMatchObject({
            evidence: { characterTags: expect.arrayContaining([character]) },
        });
    });

    it('keeps a tube preset association distinct from a tube device algorithm', () => {
        const tubePreset = receiptItems('preset', 'tube').find((item) => item.id === 'fx-dist-warm-overdrive');

        expect(tubePreset).toMatchObject({
            name: 'Warm Overdrive',
            evidence: {
                tags: expect.arrayContaining(['tube']),
                deviceTypes: ['builtin-distortion'],
            },
        });
        expect(receiptItems('device', 'tube')).toEqual([]);
    });
});

describe('planner device catalogue', () => {
    it('offers every platform-available device to the planner, Crust included', () => {
        const offered = (getProjectContext().availableDeviceTypes ?? []).map((device) => device.id);

        expect(offered).toContain('crust');
        expect(offered).toEqual(getPlatformPlugins().map((plugin) => plugin.id));
    });

    it('lets the planner add Crust to a track by its catalogue name', () => {
        const result = bridgeLlmToolCalls({
            calls: [{ name: 'addDevice', arguments: { trackId: 'track-bass', deviceType: 'Crust' } }],
            context: { ...getProjectContext(), tracks: [createVocalTrack('track-bass', 'Bass')] },
            projectPunchRegion: createPunchRegionPatch,
        });

        expect(result).toEqual({
            actions: [{ type: 'addDevice', payload: { trackId: 'track-bass', deviceType: 'crust' } }],
            rejections: [],
        });
    });
});

describe('backing-vocal plate device resolution', () => {
    it('resolves the plate device from descriptor tags, Dutch Oven on the default catalogue', () => {
        const scope = requestPlateScope(createPlateProjectContext());

        expect(scope.capability.fixedValues.plateDeviceType).toBe('dutch-oven');
        expect(addedDeviceTypes(scope)).toEqual(['builtin-filter', 'dutch-oven']);
        expect(scope.capability.fixedValues.renderTailSeconds).toBe(declaredTailSeconds('dutch-oven'));
    });

    it('follows the plate tag to another available device and records the choice', () => {
        const context = createPlateProjectContext();
        const dutchOvenTail = declaredTailSeconds('dutch-oven');

        withDescriptorChanges(
            [
                ['dutch-oven', { characterTags: ['spring'] }],
                ['builtin-reverb', { characterTags: ['plate'] }],
            ],
            () => {
                const scope = requestPlateScope(context);

                expect(scope.capability.fixedValues.plateDeviceType).toBe('builtin-reverb');
                expect(addedDeviceTypes(scope)).toEqual(['builtin-filter', 'builtin-reverb']);
                expect(scope.capability.fixedValues.renderTailSeconds).toBe(declaredTailSeconds('builtin-reverb'));
                expect(scope.capability.fixedValues.renderTailSeconds).not.toBe(dutchOvenTail);
            }
        );
    });

    it('chooses the first plate device in discovery order when several declare the character', () => {
        const context = createPlateProjectContext();

        withDescriptorChanges([['builtin-reverb', { characterTags: ['plate'] }]], () => {
            expect(requestPlateScope(context).capability.fixedValues.plateDeviceType).toBe('builtin-reverb');
        });
        withDescriptorChanges(
            [
                ['builtin-reverb', { characterTags: ['plate'] }],
                ['builtin-convolution-reverb', { characterTags: ['plate'] }],
            ],
            () => {
                expect(requestPlateScope(context).capability.fixedValues.plateDeviceType).toBe(
                    'builtin-convolution-reverb'
                );
            }
        );
    });

    it('skips a plate device unavailable on this platform in favour of the next available one', () => {
        const context = createPlateProjectContext();

        withDescriptorChanges(
            [
                ['dutch-oven', { platform: 'native' }],
                ['fermenter', { characterTags: ['plate'] }],
            ],
            () => {
                expect(requestPlateScope(context).capability.fixedValues.plateDeviceType).toBe('fermenter');
            }
        );
    });

    it('refuses with a typed reason when no device declares the plate character', () => {
        const context = createPlateProjectContext();

        withDescriptorChanges([['dutch-oven', { characterTags: ['spring'] }]], () => {
            expect(getBackingVocalPlatePromptScope(context)).toEqual(NO_PLATE_DEVICE_REFUSAL);
        });
    });

    it('does not take a display name that mentions plate for a declared plate character', () => {
        const context = createPlateProjectContext();

        withDescriptorChanges(
            [
                ['dutch-oven', { characterTags: ['spring'] }],
                ['builtin-reverb', { name: 'Plate Lookalike' }],
            ],
            () => {
                expect(getBackingVocalPlatePromptScope(context)).toEqual(NO_PLATE_DEVICE_REFUSAL);
            }
        );
    });

    it('refuses when the only plate device is unavailable on this platform', () => {
        const context = createPlateProjectContext();

        withDescriptorChanges([['dutch-oven', { platform: 'native' }]], () => {
            expect(getBackingVocalPlatePromptScope(context)).toEqual(NO_PLATE_DEVICE_REFUSAL);
        });
    });

    it('refuses when the resolved plate device is not in the planner catalogue', () => {
        const context = createPlateProjectContext({
            availableDeviceTypes: platformDeviceCatalogue().filter((device) => device.id !== 'dutch-oven'),
        });

        expect(getBackingVocalPlatePromptScope(context)).toEqual({
            status: 'invalid',
            reason: 'EX-01 plate reverb dutch-oven is not in the planner catalogue',
        });
    });
});

describe('reverb family', () => {
    it('derives the family from descriptor metadata with the membership the workflow used to list', () => {
        const storedTypes = [...getPlatformPlugins().map((plugin) => plugin.id), 'proof-chamber', 'unlisted-device'];

        expect(storedTypes.filter(isReverbDeviceType).toSorted()).toEqual(FORMER_REVERB_DEVICE_TYPES);
    });

    it('removes exactly the reverbs on a backing vocal, whatever the device type', () => {
        const backingVocalDevices = [...FORMER_REVERB_DEVICE_TYPES, 'builtin-eq', 'builtin-compressor'].map((type) => ({
            id: `device-${type}`,
            type,
            bypassed: false,
        }));

        const scope = requestPlateScope(createPlateProjectContext({ backingVocalDevices }));

        expect(scope.capability.backingVocals[0]?.removableReverbDeviceIds).toEqual(
            FORMER_REVERB_DEVICE_TYPES.map((type) => `device-${type}`)
        );
    });
});
