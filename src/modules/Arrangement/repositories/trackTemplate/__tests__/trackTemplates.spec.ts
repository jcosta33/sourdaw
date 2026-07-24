import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type TrackTemplate } from '../../../models/TrackTemplate';
import { storage } from '../helpers';
import { loadTrackTemplates } from '../loadTrackTemplates';
import { saveTrackTemplates } from '../saveTrackTemplates';

vi.mock('../helpers', () => ({
    storage: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

describe('trackTemplate repository', () => {
    type StoredTemplateValue = {
        [key: string]: unknown;
    };

    function createDevice(): TrackTemplate['devices'][number] {
        return {
            id: 'device-1',
            name: 'Synth',
            type: 'builtin-synth',
            bypassed: false,
            parameterValues: { cutoff: 0.5 },
        };
    }

    function createSend(): TrackTemplate['sends'][number] {
        return {
            busId: 'bus-1',
            level: 0.25,
            preFader: false,
        };
    }

    function createTemplate(overrides: Partial<TrackTemplate> = {}): TrackTemplate {
        return {
            id: 'template-1',
            name: 'Drums',
            category: 'Drums',
            trackKind: 'midi',
            devices: [],
            sends: [],
            gain: 0,
            pan: 0,
            color: '#ffcc00',
            createdAt: 1_717_171_717,
            ...overrides,
        };
    }

    function createStoredTemplate(overrides: StoredTemplateValue): unknown {
        return {
            ...createTemplate(),
            ...overrides,
        };
    }

    function mockStoredTemplates(value: unknown): void {
        vi.mocked(storage.get).mockReturnValue(value as ReturnType<typeof storage.get>);
    }

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('loadTrackTemplates', () => {
        it('should return an empty array when nothing is saved', () => {
            vi.mocked(storage.get).mockReturnValue(null);
            expect(loadTrackTemplates()).toEqual([]);
        });

        it('should return the saved templates', () => {
            const templates = [createTemplate()];
            vi.mocked(storage.get).mockReturnValue(templates);
            expect(loadTrackTemplates()).toEqual(templates);
        });

        it('should preserve valid nested devices and sends', () => {
            const template = createTemplate({
                devices: [createDevice()],
                sends: [createSend()],
            });
            vi.mocked(storage.get).mockReturnValue([template]);

            expect(loadTrackTemplates()).toEqual([template]);
        });

        it('should preserve a native plugin state chunk on a stored device', () => {
            const nativeDevice = {
                ...createDevice(),
                id: 'native-1',
                type: 'external-plugin',
                externalPluginId: 'plugin-abc',
                externalStateChunk: 'c2F2ZWQ=',
            };
            const template = createTemplate({ devices: [nativeDevice] });
            vi.mocked(storage.get).mockReturnValue([template]);

            expect(loadTrackTemplates()[0]?.devices[0]?.externalStateChunk).toBe('c2F2ZWQ=');
        });

        it('should drop a device whose state chunk is not a string', () => {
            const good = createTemplate({ id: 'template-2', name: 'Good' });
            mockStoredTemplates([
                createStoredTemplate({ devices: [{ ...createDevice(), externalStateChunk: 42 }] }),
                good,
            ]);

            expect(loadTrackTemplates()).toEqual([good]);
        });

        it('should return an empty array when stored data is not an array', () => {
            mockStoredTemplates({ id: 'template-1', name: 'Drums' });

            expect(loadTrackTemplates()).toEqual([]);
        });

        it('should drop invalid entries while preserving valid neighboring templates', () => {
            const firstTemplate = createTemplate({ id: 'template-1', name: 'First' });
            const secondTemplate = createTemplate({ id: 'template-2', name: 'Second', trackKind: 'audio' });

            mockStoredTemplates([
                firstTemplate,
                { ...createTemplate({ id: 'bad-kind' }), trackKind: 'invalid' },
                { ...createTemplate({ id: 'bad-gain' }), gain: Number.NaN },
                { ...createTemplate({ id: 'bad-devices' }), devices: null },
                'bad-template',
                secondTemplate,
            ]);

            expect(loadTrackTemplates()).toEqual([firstTemplate, secondTemplate]);
        });

        it.each([
            ['invalid id', createStoredTemplate({ id: 1 })],
            ['invalid name', createStoredTemplate({ name: 1 })],
            ['invalid category', createStoredTemplate({ category: 1 })],
            ['invalid trackKind', createStoredTemplate({ trackKind: 'invalid' })],
            ['invalid color', createStoredTemplate({ color: 1 })],
            ['invalid devices container', createStoredTemplate({ devices: null })],
            ['invalid device entry', createStoredTemplate({ devices: [null] })],
            [
                'invalid device parameter value',
                createStoredTemplate({ devices: [{ ...createDevice(), parameterValues: { cutoff: 'open' } }] }),
            ],
            ['invalid sends container', createStoredTemplate({ sends: null })],
            ['invalid send entry', createStoredTemplate({ sends: [{}] })],
            ['invalid send level', createStoredTemplate({ sends: [{ ...createSend(), level: Number.NaN }] })],
            ['invalid gain', createStoredTemplate({ gain: Number.NaN })],
            ['invalid pan', createStoredTemplate({ pan: Number.POSITIVE_INFINITY })],
            ['invalid createdAt', createStoredTemplate({ createdAt: Number.NEGATIVE_INFINITY })],
        ])('should drop entries with %s while preserving valid neighboring templates', (_name, invalidTemplate) => {
            const firstTemplate = createTemplate({ id: 'template-1', name: 'First' });
            const secondTemplate = createTemplate({ id: 'template-2', name: 'Second', trackKind: 'audio' });

            mockStoredTemplates([firstTemplate, invalidTemplate, secondTemplate]);

            expect(loadTrackTemplates()).toEqual([firstTemplate, secondTemplate]);
        });

        it('should return an empty array when malformed raw storage text is returned', () => {
            mockStoredTemplates('not-json');

            expect(loadTrackTemplates()).toEqual([]);
        });
    });

    describe('saveTrackTemplates', () => {
        it('should persist the given templates to storage', () => {
            const templates = [createTemplate()];
            saveTrackTemplates(templates);
            expect(storage.set).toHaveBeenCalledWith(templates);
        });
    });
});
