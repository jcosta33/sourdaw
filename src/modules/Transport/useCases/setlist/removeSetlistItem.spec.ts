import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { removeSetlistItem } from './removeSetlistItem';

const item = (id: string, dur: number): SetlistItem => ({
    id,
    name: 'A',
    projectPath: null,
    bpm: null,
    timeSignature: null,
    estimatedDuration: dur,
    notes: '',
    programChange: null,
    color: '#000',
    autoStop: true,
    gapSeconds: 0,
    markers: [],
});

describe('removeSetlistItem', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('removes item and subtracts duration', () => {
        const set = vi.fn();
        const state: SetlistState = {
            name: 'S',
            items: [item('x', 30)],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 30,
        };
        injectDependencies(removeSetlistItem, {
            setlistStore: { value: state, set } as never,
        });
        removeSetlistItem('x');
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ items: [], totalDuration: 0 }));
    });
});
