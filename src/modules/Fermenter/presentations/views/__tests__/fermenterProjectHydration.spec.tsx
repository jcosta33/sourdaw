import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { cloneFermenterPatch, toFermenterDeviceState } from '../../../models/FermenterPatchState';
import { fermenterStore, getFermenterState } from '../../../stores/fermenterStore';
import { FermenterPanel } from '../FermenterPanel';

const DEVICE_ID = 'fermenter-project-device';

function fermenterTrack(parameterValues: Record<string, number>, deviceState?: unknown): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Synth', kind: 'midi' }),
        devices: [
            { id: DEVICE_ID, name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues, deviceState },
        ],
    };
}

function renderPanel(deviceId = DEVICE_ID) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <FermenterPanel deviceId={deviceId} />
        </QueryClientProvider>
    );
}

describe('FermenterPanel project hydration', () => {
    beforeEach(() => {
        fermenterStore.set({});
        trackStore.set({
            tracks: [
                fermenterTrack({
                    filterCutoff: 600,
                    macro0: 0.75,
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
    });

    it('hydrates panel store from project parameterValues on mount', async () => {
        renderPanel(DEVICE_ID);

        await waitFor(() => {
            expect(getFermenterState(DEVICE_ID).patch.filterCutoff).toBe(600);
            expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.75);
        });
    });

    it('updates panel store when trackStore parameterValues change', async () => {
        renderPanel(DEVICE_ID);

        await waitFor(() => {
            expect(getFermenterState(DEVICE_ID).patch.filterCutoff).toBe(600);
            expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.75);
        });

        act(() => {
            trackStore.set({
                tracks: [
                    fermenterTrack({
                        filterCutoff: 1400,
                        macro0: 0.2,
                    }),
                ],
                selectedTrackId: 'track-1',
                ghostClips: [],
            });
        });

        await waitFor(() => {
            expect(getFermenterState(DEVICE_ID).patch.filterCutoff).toBe(1400);
            expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.75);
        });
    });

    it('restores the complete saved patch after closing and reopening its panel', async () => {
        const saved = cloneFermenterPatch({
            ...DEFAULT_PATCH,
            name: 'Reopened patch',
            filterCutoff: 1650,
            macros: [0.12, 0.23, 0.34, 0.45, 0.56, 0.67, 0.78, 0.89],
        });
        saved.macroMappings![4]!.targets[0]!.center = 0.625;
        trackStore.set({
            tracks: [fermenterTrack({ filterCutoff: 1650 }, toFermenterDeviceState(saved))],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        const first = renderPanel();
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(saved));
        first.unmount();

        fermenterStore.set({});
        renderPanel();

        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(saved));
        expect(getFermenterState(DEVICE_ID).patch.macroMappings?.[4]?.targets[0]?.center).toBe(0.625);
    });

    it('does not crash when trackStore snapshot is null', () => {
        act(() => {
            trackStore.set(null);
        });
        expect(() => renderPanel(DEVICE_ID)).not.toThrow();
    });
});
