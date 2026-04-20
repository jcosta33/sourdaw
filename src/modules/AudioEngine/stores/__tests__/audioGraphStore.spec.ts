import { describe, it, expect, beforeEach } from 'vitest';

import { audioGraphStore } from '../audioGraphStore';

describe('audioGraphStore', () => {
    beforeEach(() => {
        audioGraphStore.set({ routes: [] });
    });

    it('should have initial state', () => {
        expect(audioGraphStore.value?.routes).toHaveLength(0);
    });

    it('should update state', () => {
        const route = { id: 'r1', sourceId: 's1', destinationId: 'd1', gain: 1 };
        audioGraphStore.update((s) => ({ ...s!, routes: [route] }));
        expect(audioGraphStore.value?.routes).toHaveLength(1);
        expect(audioGraphStore.value?.routes[0]).toEqual(route);
    });
});
