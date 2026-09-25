import { describe, expect, it, vi } from 'vitest';

import { BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION } from '../../models/BacteriaModAssignmentsState';
import { type BacteriaModAssignment } from '../../models/BacteriaPatch';
import { prepareOfflineBacteria } from '../prepareOfflineBacteria';

function row(overrides: Partial<BacteriaModAssignment> = {}): BacteriaModAssignment {
    return { sourceId: 'lfo1', targetParam: 'band0_gain', amount: 0.5, bipolar: true, ...overrides };
}

function chunkWithRows(rows: BacteriaModAssignment[]) {
    return { version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION, data: { modAssignments: rows } };
}

function makePort() {
    return { postMessage: vi.fn() } as unknown as MessagePort;
}

describe('prepareOfflineBacteria', () => {
    it('posts the mapped table for one LFO1 → band gain row', () => {
        const port = makePort();

        prepareOfflineBacteria({ deviceState: chunkWithRows([row()]), port });

        expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
            type: 'set-mod-assignments',
            assignments: [{ sourceId: 0, targetParam: 1, amount: 0.5 }],
        });
    });

    it('posts nothing when there is no chunk', () => {
        const port = makePort();

        prepareOfflineBacteria({ deviceState: undefined, port });

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('posts nothing when the table exceeds the live node’s 64-row limit', () => {
        const port = makePort();
        const rows = Array.from({ length: 65 }, () => row());

        prepareOfflineBacteria({ deviceState: chunkWithRows(rows), port });

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('posts the whole table at exactly the live node’s 64-row limit', () => {
        const port = makePort();
        const rows = Array.from({ length: 64 }, () => row());

        prepareOfflineBacteria({ deviceState: chunkWithRows(rows), port });

        expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
            type: 'set-mod-assignments',
            assignments: Array.from({ length: 64 }, () => ({ sourceId: 0, targetParam: 1, amount: 0.5 })),
        });
    });

    it('posts the captured table, ignoring an absent deviceState, when captured is supplied (#4756)', () => {
        const port = makePort();

        prepareOfflineBacteria({ deviceState: undefined, port, captured: { assignments: [row()] } });

        expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
            type: 'set-mod-assignments',
            assignments: [{ sourceId: 0, targetParam: 1, amount: 0.5 }],
        });
    });
});
