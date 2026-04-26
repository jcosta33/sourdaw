import { vi } from 'vitest';
import type { getMarkerState } from '#/modules/Arrangement/useCases';
import type { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';

const mocks = vi.hoisted(() => ({
    getMarkerState: vi.fn<typeof getMarkerState>(),
    getTransportStoreValue: vi.fn<typeof getTransportStoreValue>(),
    seekPlayhead: vi.fn<typeof seekPlayhead>(),
}));
