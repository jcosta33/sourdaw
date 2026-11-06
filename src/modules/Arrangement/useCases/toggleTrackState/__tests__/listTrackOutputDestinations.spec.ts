import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listTrackOutputDestinations } from '../listTrackOutputDestinations';

const mocks = vi.hoisted(() => ({
    getAllSidechainRoutes: vi.fn(),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    getAllSidechainRoutes: mocks.getAllSidechainRoutes,
}));

type Row = {
    id: string;
    kind: string;
    outputId: string;
    sends: { busId: string }[];
};

const row = (id: string, kind: string, over: Partial<Row> = {}): Row => ({
    id,
    kind,
    outputId: 'master',
    sends: [],
    ...over,
});

const ids = (rows: readonly Row[]): string[] => rows.map((destination) => destination.id);

describe('listTrackOutputDestinations', () => {
    beforeEach(() => {
        mocks.getAllSidechainRoutes.mockReturnValue([]);
    });

    it('lists the buses an audio track can output to, and nothing that is not a bus', () => {
        const tracks = [
            row('kick', 'audio'),
            row('drums', 'bus'),
            row('group', 'folder'),
            row('keys', 'midi'),
            row('verb', 'bus'),
        ];

        expect(ids(listTrackOutputDestinations('kick', tracks))).toEqual(['drums', 'verb']);
    });

    it('never lists the track itself', () => {
        const tracks = [row('drums', 'bus'), row('verb', 'bus')];

        expect(ids(listTrackOutputDestinations('drums', tracks))).toEqual(['verb']);
    });

    it('drops a bus whose output, send or sidechain reaches the track, directly or through another bus', () => {
        mocks.getAllSidechainRoutes.mockReturnValue([{ sourceTrackId: 'duck', targetTrackId: 'drums' }]);
        const tracks = [
            row('drums', 'bus'),
            row('direct', 'bus', { outputId: 'drums' }),
            row('viaSend', 'bus', { sends: [{ busId: 'drums' }] }),
            row('twoHops', 'bus', { outputId: 'direct' }),
            row('duck', 'bus'),
            row('free', 'bus'),
        ];

        expect(ids(listTrackOutputDestinations('drums', tracks))).toEqual(['free']);
    });
});
