import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { setTrackCanonicalRole } from '#/modules/Project/useCases';

import { TrackRoleSection } from '../TrackRoleSection';

vi.mock('#/modules/Project/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/Project/useCases')>()),
    setTrackCanonicalRole: vi.fn(),
}));

describe('TrackRoleSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStore.set(structuredClone(defaultProjectStoreState));
    });
    it('unconditionally shows role and source, dispatches a revision-bound override and exposes automatic mode', async () => {
        vi.mocked(setTrackCanonicalRole).mockResolvedValue();
        render(<TrackRoleSection track={createTrack({ id: 't', name: 'Kick', kind: 'midi' })} />);
        const control = screen.getByRole('combobox', { name: 'Track role' });
        expect(control).toBeVisible();
        expect(screen.getByText('kick · Track name or kind')).toBeVisible();
        fireEvent.change(control, { target: { value: 'snare' } });
        await waitFor(() =>
            expect(setTrackCanonicalRole).toHaveBeenCalledWith({
                trackId: 't',
                role: 'snare',
                expectedRevision: projectStore.value!.productionBrief.revision,
            })
        );
        await waitFor(() => expect(control).not.toBeDisabled());
        fireEvent.change(control, { target: { value: '' } });
        await waitFor(() =>
            expect(setTrackCanonicalRole).toHaveBeenLastCalledWith({
                trackId: 't',
                role: null,
                expectedRevision: projectStore.value!.productionBrief.revision,
            })
        );
    });
    it('renders master and reports refused edits without claiming success', async () => {
        vi.mocked(setTrackCanonicalRole).mockRejectedValue(new Error('Production brief changed; try again.'));
        render(<TrackRoleSection track={createTrack({ id: 'master', name: 'Master', kind: 'master' })} />);
        expect(screen.getByText('master · Track name or kind')).toBeVisible();
        fireEvent.change(screen.getByRole('combobox', { name: 'Track role' }), { target: { value: 'bus' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Production brief changed; try again.');
        expect(screen.getByRole('combobox', { name: 'Track role' })).toHaveValue('');
    });
    it('shows unsupported saved overrides without rewriting them on render', () => {
        const project = projectStore.value!;
        projectStore.set({
            ...project,
            productionBrief: {
                ...project.productionBrief,
                trackRoles: [{ id: 'legacy', trackId: 't', role: 'legacy lead', createdAt: 0 }],
            },
        });
        render(<TrackRoleSection track={createTrack({ id: 't', name: 'Kick', kind: 'midi' })} />);
        expect(screen.getByRole('combobox', { name: 'Track role' })).toHaveValue('legacy');
        expect(screen.getByText('unknown · Production brief')).toBeVisible();
        expect(setTrackCanonicalRole).not.toHaveBeenCalled();
        expect(projectStore.value!.productionBrief.trackRoles[0]!.role).toBe('legacy lead');
    });
});
