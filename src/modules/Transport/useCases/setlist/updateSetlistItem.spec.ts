import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { updateSetlistItem } from './updateSetlistItem';

const item = (id: string): SetlistItem => ({
    id,
    name: 'Old',
    projectPath: null,
    bpm: null,
    timeSignature: null,
    estimatedDuration: 1,
    notes: '',
    programChange: null,
    color: '#000',
    autoStop: true,
    gapSeconds: 0,
    markers: [],
});

describe('updateSetlistItem', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('merges updates into matching item', () => {
        const set = vi.fn();
        const state: SetlistState = {
            name: 'S',
            items: [item('x')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 1,
        };
        injectDependencies(updateSetlistItem, {
            setlistStore: { value: state, set } as never,
        });
        updateSetlistItem('x', { name: 'New' });
        const next = set.mock.calls[0]![0] as SetlistState;
        expect(next.items[0]!.name).toBe('New');
    });
});
