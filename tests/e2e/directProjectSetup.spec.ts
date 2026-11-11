import { expect, test } from './e2eTest';
import { LAUNCH_SCREEN_NAME, add_midi_track, launch_new_project, setupWorkspace } from './e2eUtils';

import type {
    ProjectInspectionModule,
    ProjectInspectionRecord,
    ProjectInspectionValue,
} from './directProjectSetupContract';

const DIRECT_SETUP_ENTRY_PATH = '/e2e/direct-project-setup.js';

function inspectionRecord(value: ProjectInspectionValue): ProjectInspectionRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected an inspection record');
    }
    return value;
}

function inspectionTracks(snapshot: ReturnType<ProjectInspectionModule['inspectProject']>): ProjectInspectionRecord[] {
    const tracks = inspectionRecord(snapshot.project?.tracks).tracks;
    if (!Array.isArray(tracks)) {
        throw new TypeError('Expected the live raw track array');
    }
    return tracks.map(inspectionRecord);
}

test.describe('Direct project setup', () => {
    test('direct entry exports newProject and resolves at the deterministic path', async ({ page }) => {
        await setupWorkspace(page);
        const hasNewProject = await page.evaluate(async (entryPath) => {
            const mod: { newProject?: unknown } = await import(entryPath);
            return typeof mod.newProject === 'function';
        }, DIRECT_SETUP_ENTRY_PATH);
        expect(hasNewProject).toBe(true);
    });

    test('creates a blank project without any launch-screen interaction', async ({ page }) => {
        await setupWorkspace(page);
        // Hide the launch-screen button so a UI-click implementation cannot fall
        // back to it; the direct module route must succeed despite its absence.
        await page.addStyleTag({ content: '#launch-new-project { display: none !important; }' });

        await launch_new_project(page);

        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toHaveCount(0);
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();

        // Verify the project is a live editable document by renaming it.
        await page.getByRole('button', { name: 'Untitled Project' }).click();
        const input = page.locator('input:focus');
        await input.fill('Direct Setup Test');
        await input.press('Enter');
        await expect(page.getByRole('button', { name: 'Direct Setup Test' })).toBeVisible();
    });

    test('inspection follows real UI track edits and complete action history in the running app', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        const inspect = () =>
            page.evaluate(async (entryPath) => {
                const entry: ProjectInspectionModule = await import(entryPath);
                return entry.inspectProject();
            }, DIRECT_SETUP_ENTRY_PATH);
        const before = await inspect();

        await add_midi_track(page);
        const mute = page.locator('[data-testid^="track-mute-"]').first();
        await expect(mute).toHaveAttribute('data-active', 'false');
        const muteId = await mute.getAttribute('data-testid');
        expect(muteId).toBeTruthy();
        const trackId = muteId?.slice('track-mute-'.length);
        expect(trackId).toBeTruthy();
        await expect
            .poll(async () => (await inspect()).history.past.length)
            .toBeGreaterThan(before.history.past.length);
        const added = await inspect();
        expect(added.project).not.toBeNull();
        expect(added.project).toEqual(
            expect.objectContaining({
                tracks: expect.objectContaining({
                    tracks: expect.arrayContaining([expect.objectContaining({ id: trackId, muted: false })]),
                }),
            })
        );
        expect(added.revision).not.toBe(before.revision);
        expect(added.history.past).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'action',
                    action: expect.objectContaining({ type: 'addTrack' }),
                    inverseAction: expect.any(Object),
                }),
            ])
        );
        expect(added.history.undoTree).not.toBeNull();

        await page.getByTestId('add-track-button').getByRole('button').click();
        await page.getByTestId('add-track-midi').click();
        const muteButtons = page.locator('[data-testid^="track-mute-"]');
        await expect(muteButtons).toHaveCount(2);
        const visibleTrackIds = await muteButtons.evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute('data-testid')?.slice('track-mute-'.length))
        );
        expect(visibleTrackIds).toContain(trackId);
        expect(new Set(visibleTrackIds).size).toBe(2);
        await expect.poll(async () => (await inspect()).history.past.length).toBe(added.history.past.length + 1);
        const second = await inspect();
        expect(second.revision).not.toBe(added.revision);
        const secondTracks = inspectionTracks(second);
        const firstTracks = inspectionTracks(added);
        expect(secondTracks.slice(0, -1)).toEqual(firstTracks);
        expect(secondTracks.at(-1)).toEqual(expect.objectContaining({ id: visibleTrackIds[1], muted: false }));
        expect(secondTracks.filter((track) => track.kind === 'midi').map((track) => track.id)).toEqual(visibleTrackIds);
        expect(second.history.past.slice(0, -1)).toEqual(added.history.past);
        for (const [index, id] of visibleTrackIds.entries()) {
            expect(second.history.past[index]).toEqual(
                expect.objectContaining({
                    kind: 'action',
                    action: expect.objectContaining({
                        type: 'addTrack',
                        payload: expect.objectContaining({ id, kind: 'midi' }),
                    }),
                    inverseAction: expect.objectContaining({
                        type: 'discardCreatedTrack',
                        payload: expect.objectContaining({
                            trackId: id,
                            generatedMidiStateGuard: { entityJson: expect.any(String), midiByClipIdJson: '{}' },
                        }),
                    }),
                })
            );
            const inverse = inspectionRecord(second.history.past[index]?.inverseAction);
            const guard = inspectionRecord(inspectionRecord(inverse.payload).generatedMidiStateGuard);
            if (typeof guard.entityJson !== 'string') {
                throw new TypeError('Expected the complete captured track inverse');
            }
            const inverseTrack: unknown = JSON.parse(guard.entityJson);
            expect(inverseTrack).toEqual(secondTracks.find((track) => track.id === id));
            // addTrack replays its captured forward action; no separate redo action is produced.
            expect(second.history.past[index]).not.toHaveProperty('redoAction');
        }
        expect(second.history.future).toEqual([]);
        expect(second.history.undoTree).toEqual({
            enabled: false,
            tree: { nodes: {}, currentNodeId: null, rootId: 'undo-root', nextId: 1 },
        });
        expect(second.history.undoTree).toEqual(added.history.undoTree);
    });
});
