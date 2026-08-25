import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { createTrack } from '../../models/Track';
import { type TrackTemplate } from '../../models/TrackTemplate';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { loadTrackTemplates } from '../../repositories/trackTemplate/loadTrackTemplates';
import { loadTrackTemplate } from '../loadTrackTemplate';
import { trackTemplateCache } from '../trackTemplate';

const injectedWithheldDeviceTypes = vi.hoisted(() => new Set<string>());

vi.mock('../../models/Track', () => ({
    createTrack: vi.fn(),
}));

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn(),
}));

vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn(),
}));

vi.mock('../../repositories/trackTemplate/loadTrackTemplates', () => ({
    loadTrackTemplates: vi.fn(),
}));
vi.mock('#/infra/release/deviceReleaseAdmission', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/release/deviceReleaseAdmission')>();

    return {
        ...actual,
        findWithheldDeviceType: (devices: ReadonlyArray<{ type: string }>) =>
            devices.find(({ type }) => injectedWithheldDeviceTypes.has(type))?.type ??
            actual.findWithheldDeviceType(devices),
    };
});
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

describe('loadTrackTemplate', () => {
    function createTemplate(overrides: Partial<TrackTemplate> = {}): TrackTemplate {
        return {
            id: 'template-1',
            name: 'Lead Template',
            category: 'User',
            trackKind: 'midi',
            devices: [],
            sends: [],
            gain: 0.8,
            pan: 0,
            color: '#ff0000',
            createdAt: 1_717_171_717,
            ...overrides,
        };
    }

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        injectedWithheldDeviceTypes.clear();
        trackTemplateCache.templates = null;
    });

    it('should no-op when the template is missing', () => {
        vi.mocked(loadTrackTemplates).mockReturnValue([createTemplate({ id: 'other-template' })]);

        loadTrackTemplate('missing-template');

        expect(createTrack).not.toHaveBeenCalled();
        expect(getTrackState).not.toHaveBeenCalled();
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('preserves but does not instantiate a template containing a withheld device', () => {
        injectedWithheldDeviceTypes.add('test-withheld-device');
        const template = createTemplate({
            devices: [
                {
                    id: 'withheld-source',
                    name: 'Withheld test device',
                    type: 'test-withheld-device',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        });
        trackTemplateCache.templates = [template];

        loadTrackTemplate(template.id);

        expect(trackTemplateCache.templates).toEqual([template]);
        expect(createTrack).not.toHaveBeenCalled();
        expect(getTrackState).not.toHaveBeenCalled();
        expect(setTrackState).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(
            'Template contains withheld device "test-withheld-device" and was not loaded.',
            'warning'
        );
    });

    it('should no-op when track state is unavailable', () => {
        const template = createTemplate();
        const createdTrack = TrackDummy.create({ id: 'new-track', name: 'Lead Template', kind: 'midi' });

        trackTemplateCache.templates = [template];
        vi.mocked(createTrack).mockReturnValue(createdTrack);
        vi.mocked(getTrackState).mockReturnValue(null);

        loadTrackTemplate('template-1');

        expect(createTrack).toHaveBeenCalledWith({ name: 'Lead Template', kind: 'midi' });
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('should append a new track with cloned devices and sends from the template', () => {
        const existingTrack = TrackDummy.create({ id: 'existing-track', name: 'Existing' });
        const createdTrack = TrackDummy.create({
            id: 'new-track',
            name: 'Lead Template',
            kind: 'midi',
            devices: [],
            sends: [],
            gain: 0.8,
            pan: 0,
            color: '#111111',
        });
        const firstDevice = {
            id: 'source-device-1',
            name: 'Synth',
            type: 'builtin-synth',
            bypassed: false,
            parameterValues: { cutoff: 0.5 },
        };
        const secondDevice = {
            id: 'source-device-2',
            name: 'Delay',
            type: 'builtin-delay',
            bypassed: true,
            parameterValues: { feedback: 0.25 },
        };
        const send = {
            busId: 'bus-1',
            level: 0.4,
            preFader: true,
        };
        const template = createTemplate({
            devices: [firstDevice, secondDevice],
            sends: [send],
            gain: 0.55,
            pan: 0.2,
            color: '#00ffaa',
        });

        vi.mocked(loadTrackTemplates).mockReturnValue([template]);
        vi.mocked(createTrack).mockReturnValue(createdTrack);
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [existingTrack],
            selectedTrackId: 'existing-track',
            ghostClips: [],
        });
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
            .mockReturnValueOnce('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

        loadTrackTemplate('template-1');

        expect(createTrack).toHaveBeenCalledWith({ name: 'Lead Template', kind: 'midi' });

        const nextState = vi.mocked(setTrackState).mock.calls[0]?.[0];
        if (!nextState) {
            throw new Error('Expected setTrackState to receive next track state');
        }

        expect(nextState.selectedTrackId).toBe('existing-track');
        expect(nextState.ghostClips).toEqual([]);
        expect(nextState.tracks[0]).toBe(existingTrack);

        const appliedTrack = nextState.tracks[1];
        if (!appliedTrack) {
            throw new Error('Expected loaded template track to be appended');
        }

        expect(appliedTrack.id).toBe('new-track');
        expect(appliedTrack.devices).toEqual([
            { ...firstDevice, id: 'dev-aaaaaaaa' },
            { ...secondDevice, id: 'dev-bbbbbbbb' },
        ]);
        expect(appliedTrack.devices[0]).not.toBe(firstDevice);
        expect(appliedTrack.devices[1]).not.toBe(secondDevice);
        expect(appliedTrack.sends).toEqual([send]);
        expect(appliedTrack.sends[0]).not.toBe(send);
        expect(appliedTrack.gain).toBe(0.55);
        expect(appliedTrack.pan).toBe(0.2);
        expect(appliedTrack.color).toBe('#00ffaa');
    });

    it('starts a template native plugin dormant while carrying its saved state chunk', () => {
        const nativeDevice = {
            id: 'source-native',
            name: 'Reverb',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalPluginId: 'plugin-abc',
            externalInstanceId: 'plugin-abc-live',
            externalStateChunk: 'c2F2ZWQ=',
        };
        const createdTrack = TrackDummy.create({
            id: 'new-track',
            name: 'Lead Template',
            kind: 'midi',
            devices: [],
            sends: [],
        });
        const template = createTemplate({ devices: [nativeDevice] });

        trackTemplateCache.templates = [template];
        vi.mocked(createTrack).mockReturnValue(createdTrack);
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

        loadTrackTemplate('template-1');

        const nextState = vi.mocked(setTrackState).mock.calls[0]?.[0];
        if (!nextState) {
            throw new Error('Expected setTrackState to receive next track state');
        }
        const appliedDevice = nextState.tracks[0]?.devices[0];
        if (!appliedDevice) {
            throw new Error('Expected applied template device');
        }

        // Must NOT reuse the template's live host instance id.
        expect(appliedDevice.externalInstanceId).toBeUndefined();
        // But it inherits the plugin binding and the saved state chunk (the sound).
        expect(appliedDevice.externalPluginId).toBe('plugin-abc');
        expect(appliedDevice.externalStateChunk).toBe('c2F2ZWQ=');
        expect(appliedDevice.id).toBe('dev-cccccccc');
    });
});
