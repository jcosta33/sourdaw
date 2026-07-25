import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadTrackTemplates } from '../loadTrackTemplates';

const mocks = vi.hoisted(() => ({
    get: vi.fn<() => unknown>(),
}));

vi.mock('../helpers', () => ({
    storage: { get: mocks.get },
}));

function validTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'tpl-1',
        name: 'Bass',
        category: 'Basses',
        trackKind: 'audio',
        devices: [],
        sends: [],
        gain: 0.8,
        pan: 0,
        color: '#fff',
        createdAt: 1000,
        ...overrides,
    };
}

describe('loadTrackTemplates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns parsed templates unchanged when storage is well-formed', () => {
        mocks.get.mockReturnValue([validTemplate()]);

        expect(loadTrackTemplates()).toEqual([expect.objectContaining({ id: 'tpl-1', trackKind: 'audio' })]);
    });

    it('returns an empty list when storage is not an array', () => {
        mocks.get.mockReturnValue({ not: 'an array' });

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops templates whose root value is not a record', () => {
        mocks.get.mockReturnValue(['not-a-record', validTemplate()]);

        expect(loadTrackTemplates()).toHaveLength(1);
    });

    it('drops templates whose devices value is not an array', () => {
        mocks.get.mockReturnValue([validTemplate({ devices: 'nope' })]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops templates whose sends value is not an array', () => {
        mocks.get.mockReturnValue([validTemplate({ sends: 'nope' })]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops a device missing required string/boolean fields', () => {
        mocks.get.mockReturnValue([
            validTemplate({ devices: [{ id: 1, name: 'X', type: 'delay', bypassed: false, parameterValues: {} }] }),
        ]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops a device whose parameterValues holds a non-finite number', () => {
        mocks.get.mockReturnValue([
            validTemplate({
                devices: [
                    {
                        id: 'd1',
                        name: 'X',
                        type: 'delay',
                        bypassed: false,
                        parameterValues: { gain: Number.NaN },
                    },
                ],
            }),
        ]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops a device whose externalInstanceId is present but not a string', () => {
        mocks.get.mockReturnValue([
            validTemplate({
                devices: [
                    {
                        id: 'd1',
                        name: 'X',
                        type: 'external-plugin',
                        bypassed: false,
                        parameterValues: {},
                        externalInstanceId: 42,
                    },
                ],
            }),
        ]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('keeps a fully valid device including optional external plugin fields', () => {
        mocks.get.mockReturnValue([
            validTemplate({
                devices: [
                    {
                        id: 'd1',
                        name: 'X',
                        type: 'external-plugin',
                        bypassed: true,
                        parameterValues: { mix: 0.5 },
                        externalPluginId: 'plugin-x',
                        externalInstanceId: 'inst-1',
                        externalStateChunk: 'chunk',
                    },
                ],
            }),
        ]);

        const [template] = loadTrackTemplates();
        expect(template?.devices[0]).toMatchObject({
            externalPluginId: 'plugin-x',
            externalInstanceId: 'inst-1',
            externalStateChunk: 'chunk',
            bypassed: true,
        });
    });

    it('drops a send missing required fields', () => {
        mocks.get.mockReturnValue([validTemplate({ sends: [{ busId: 1, level: 0.5, preFader: true }] })]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('keeps a valid send', () => {
        mocks.get.mockReturnValue([validTemplate({ sends: [{ busId: 'bus-1', level: 0.4, preFader: true }] })]);

        const [template] = loadTrackTemplates();
        expect(template?.sends).toEqual([{ busId: 'bus-1', level: 0.4, preFader: true }]);
    });

    it('drops a device whose parameterValues is not a record object', () => {
        mocks.get.mockReturnValue([
            validTemplate({
                devices: [{ id: 'd1', name: 'X', type: 'delay', bypassed: false, parameterValues: 'not-a-record' }],
            }),
        ]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops a device whose externalPluginId is present but not a string', () => {
        mocks.get.mockReturnValue([
            validTemplate({
                devices: [
                    {
                        id: 'd1',
                        name: 'X',
                        type: 'external-plugin',
                        bypassed: false,
                        parameterValues: {},
                        externalPluginId: 99,
                    },
                ],
            }),
        ]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops a device whose externalStateChunk is present but not a string', () => {
        mocks.get.mockReturnValue([
            validTemplate({
                devices: [
                    {
                        id: 'd1',
                        name: 'X',
                        type: 'external-plugin',
                        bypassed: false,
                        parameterValues: {},
                        externalStateChunk: false,
                    },
                ],
            }),
        ]);

        expect(loadTrackTemplates()).toEqual([]);
    });

    it('drops a send that is not a record', () => {
        mocks.get.mockReturnValue([validTemplate({ sends: ['not-a-record'] })]);

        expect(loadTrackTemplates()).toEqual([]);
    });
});
