import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { fermenterStore, getFermenterState } from '../../../stores/fermenterStore';
import { FermenterPanel } from '../FermenterPanel';

const DEVICE_ID = 'fermenter-project-device';

function fermenterTrack(parameterValues: Record<string, number>): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Synth', kind: 'midi' }),
        devices: [{ id: DEVICE_ID, name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues }],
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
            expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.2);
        });
    });
});
