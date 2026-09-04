/**
 * Issue #2898 positive control: opening a saved project from the workspace
 * Recent Projects menu after a fresh renderer auto-restored a blank project.
 *
 * Models the observed E2E flow (hosted run 33027864525, job 98373414234,
 * tests/e2e/smoke.spec.ts at PR #2870 head f20fd33): session 1 saves project
 * A and then starts blank project B; a fresh renderer boot-restores B through
 * the real `loadProject`; the real `RecentProjectsMenu.handleLoad` then runs
 * its save-before-switch against B followed by `loadRecentProject(A)`. The
 * oracle is the active project truth (`projectStore`), not use-case return
 * values.
 *
 * The committed case passes against the current tree and witnesses the whole
 * switch: the pre-switch save's snapshot of the blank project on disk (it
 * carries a post-restore rename session 1 never saved, and is read back
 * through the real load path), the blank project's recent-projects entry, and
 * the loaded project's durable identity. The #2898 silent stall is REPRODUCED
 * here by the characterization case: a null audio-buffer candidate drives the
 * real replaceProjectData into its abort path, loadRecentProject returns
 * 'aborted', and handleLoad silently does nothing — the active project stays
 * on the blank one with no surfaced error. The E2E-only suspects that survive
 * are any other stubbed seam plus the CRDT worker boundary (real
 * worker-backed persistence and revision epochs racing the pre-switch save),
 * which a Project-module spec cannot drive without deep-importing
 * CrdtDocument's test harness — forbidden by the tests boundary cruise.
 *
 * Declaration order is load-bearing. The transition machinery keeps
 * module-global ordering counters, so after the committed case's explicit
 * load activates, a later yielding boot restore correctly stands down
 * (`runProjectLoadTransaction`) — one module registry admits exactly one
 * boot-restore-then-switch scenario. The characterization case therefore
 * models the restored-blank workspace directly instead of re-running the
 * boot `loadProject`; the stall mechanism it pins — the load's audio-buffer
 * candidate aborting — does not read the boot transition.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn<() => string>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
    importCachedAudioBuffers:
        vi.fn<() => Promise<{ persist: () => Promise<boolean>; publish: () => undefined } | null>>(),
    loadCrdtProject: vi.fn<() => Promise<boolean>>(),
    projectCrdtToStores: vi.fn<() => void>(),
    resetCrdtProjectAuthority: vi.fn<(name: string, onAuthorityReplaced?: () => void) => void>(),
    getCrdtDoc: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureDurableDocumentWitness: vi.fn(),
    captureProjectRevision: mocks.captureProjectRevision,
    compactProject: vi.fn(() => Promise.resolve()),
    getCrdtDoc: mocks.getCrdtDoc,
    loadCrdtProject: mocks.loadCrdtProject,
    persistCrdtProject: mocks.persistCrdtProject,
    projectActionHistoryToStore: vi.fn(),
    projectCrdtToStores: mocks.projectCrdtToStores,
    resetCrdtProjectAuthority: mocks.resetCrdtProjectAuthority,
    startCrdtAutoSave: vi.fn(() => vi.fn()),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    clearUndoHistory: vi.fn(),
    executeAppAction: vi.fn(() => Promise.resolve()),
    reconcileSessionUndoForProject: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    migrateAbsoluteMidiNotes: vi.fn(),
    readLegacyChordTrackMigration: vi.fn(() => undefined),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    ensureTrackStrips: vi.fn(),
    stopPlayback: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cancelPendingAudioBufferImport: vi.fn(),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    exportCachedAudioBuffers: vi.fn(() => Promise.resolve({})),
    getAudioContext: vi.fn(() => ({ sampleRate: 44_100 })),
    importCachedAudioBuffers: mocks.importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb: vi.fn(() =>
        Promise.resolve({ cancel: () => undefined, publish: () => undefined })
    ),
    resetAudioGraph: vi.fn(),
    restoreCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    readPluginState: vi.fn(() => ''),
    unloadPlugin: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('../../../useCases/projectPersistence/helpers/autoSaveHandle', () => ({ setAutoSaveHandle: vi.fn() }));
vi.mock('../../../useCases/projectPersistence/helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: vi.fn() }));
vi.mock('../../../useCases/projectPersistence/helpers/hydrateArrangementStoreFromProjectData', () => ({
    hydrateArrangementStoreFromProjectData: vi.fn(),
}));
vi.mock('../../../useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: vi.fn(),
}));
vi.mock('../../../useCases/projectPersistence/helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));
vi.mock('../../../useCases/projectPersistence/helpers/verifyAudioBufferReferences', () => ({
    verifyAudioBufferReferences: vi.fn(),
}));

// RecentProjectsMenu collaborators that are not this flow under test.
vi.mock('../../../useCases/projectPersistence/newProject', () => ({ newProject: vi.fn() }));
vi.mock('../../../useCases/projectPersistence/fileIO/exportProjectFile', () => ({ exportProjectFile: vi.fn() }));
vi.mock('../../../useCases/projectPersistence/fileIO/pickAndImportProjectFile', () => ({
    pickAndImportProjectFile: vi.fn(),
}));
vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
    openExportDialog: vi.fn(),
}));

// Shared UI chrome — mocked exactly as the component-level menu spec mocks it.
vi.mock('#/components/daw/DawKeycap', () => ({
    DawKeycap: ({ children }: { children: React.ReactNode }) => <kbd data-testid="keycap">{children}</kbd>,
}));
vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        variant,
        size,
        asChild: _asChild,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string; size?: string; asChild?: boolean }) => (
        <button type="button" data-variant={variant} data-size={size} {...props}>
            {children}
        </button>
    ),
}));
vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../TemplateChooser', () => ({
    TemplateChooser: () => null,
}));

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { installFakeIndexedDb } from '../../../__tests__/fakeIndexedDb';
import { arrangementStore, defaultArrangementStoreState } from '../../../stores/arrangementStore';
import { defaultProjectStoreState, projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import { loadProject } from '../../../useCases/projectPersistence/loadProject';
import { setProjectIdentityTransitionDependencies } from '../../../useCases/projectPersistence/projectIdentityTransitionDependencies';
import { renameProject } from '../../../useCases/projectPersistence/saveProject/renameProject';
import { saveProject } from '../../../useCases/projectPersistence/saveProject/saveProject';
import { getRecentProjects } from '../../../useCases/recentProjects/helpers';
import { loadRecentProject } from '../../../useCases/recentProjects/loadRecentProject';
import { RecentProjectsMenu } from '../RecentProjectsMenu';

const SAVED_PROJECT_NAME = 'Saved Song';
const BLANK_PROJECT_NAME = 'Untitled Project';
/** Session-2 rename of the blank project, made after the boot restore so only
 *  the pre-switch save can ever have persisted it. */
const RENAMED_BLANK_NAME = 'Blank Renamed After Restore';
const A_CREATED_AT = 1_700_000_000_000;
const B_CREATED_AT = 1_700_000_900_000;
const A_PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A_RECENT_KEY = `sourdaw:project:${A_CREATED_AT}`;
const B_RECENT_KEY = `sourdaw:project:${B_CREATED_AT}`;

function makeProjectState(input: {
    name: string;
    createdAt: number;
    projectId: string;
    initialized: boolean;
}): ProjectStoreState {
    return {
        projectId: input.projectId,
        name: input.name,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        dirty: false,
        loading: false,
        identityMigrationPending: false,
        identityPersistencePending: false,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
        },
        productionBrief: structuredClone(defaultProjectStoreState.productionBrief),
        initialized: input.initialized,
    };
}

/** The live module stores `buildProjectData` serializes, blank as a new project holds them. */
function resetLiveStoresToBlank(): void {
    trackStore.set(structuredClone(defaultTrackState));
    transportStore.set(structuredClone(defaultTransportState));
    automationStore.set({ lanes: [] });
    // The default the store's own sanitizer seeds: `probabilitySeed` is filled
    // from the live value's fallback when omitted.
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    arrangementStore.set(structuredClone(defaultArrangementStoreState));
}

/** Session 1: A exists with content and is saved (named snapshot + recent entry). */
async function saveProjectA(): Promise<void> {
    projectStore.set(
        makeProjectState({
            name: SAVED_PROJECT_NAME,
            createdAt: A_CREATED_AT,
            projectId: A_PROJECT_ID,
            initialized: true,
        })
    );
    trackStore.set({
        tracks: [
            normalizeTrack({ id: 'track-a', name: 'Lead', kind: 'audio' }),
            normalizeTrack({ id: 'track-master', name: 'Master', kind: 'master' }),
        ],
        selectedTrackId: null,
    });

    const saved = await saveProject();
    expect(saved).toBe(true);
    expect(getRecentProjects().some((entry) => entry.key === A_RECENT_KEY)).toBe(true);
}

/**
 * Session 1 tail: the user starts blank project B (Project menu → New
 * Project). Modelled as the metadata `newProject` publishes once its initial
 * compaction settled — canonical fresh identity, nothing pending.
 */
function startBlankProjectB(): void {
    resetLiveStoresToBlank();
    projectStore.set(
        makeProjectState({
            name: BLANK_PROJECT_NAME,
            createdAt: B_CREATED_AT,
            projectId: B_PROJECT_ID,
            initialized: true,
        })
    );
}

/**
 * Fresh renderer: module state starts from the store defaults (`loading:
 * true`, `initialized: false`) and the boot `loadProject` restores the
 * persisted blank project through the real transition machinery.
 */
async function bootRestoreBlankProjectB(): Promise<void> {
    projectStore.set(structuredClone(defaultProjectStoreState));
    resetLiveStoresToBlank();

    // The persisted B document's durable projectMeta, applied with the real
    // `fromCrdt` semantics: durable fields from the document, transient flags
    // preserved from the current (pre-boot) state.
    mocks.projectCrdtToStores.mockImplementation(() => {
        const current = projectStore.value;
        projectStore.set({
            ...makeProjectState({
                name: BLANK_PROJECT_NAME,
                createdAt: B_CREATED_AT,
                projectId: B_PROJECT_ID,
                initialized: false,
            }),
            dirty: current?.dirty ?? false,
            loading: current?.loading ?? true,
            identityMigrationPending: current?.identityMigrationPending ?? false,
            identityPersistencePending: current?.identityPersistencePending ?? false,
        });
    });

    const loaded = await loadProject();
    expect(loaded).toBe(true);
    // The workspace is up on the restored blank project, exactly where the
    // E2E clicks the menu.
    expect(projectStore.value?.name).toBe(BLANK_PROJECT_NAME);
    expect(projectStore.value?.loading).toBe(false);
    expect(projectStore.value?.initialized).toBe(true);
}

describe('recent-menu switch after a fresh renderer restored the blank project (#2898)', () => {
    let idbControls: ReturnType<typeof installFakeIndexedDb> | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        // One fake IndexedDB world across tests: storageSupport caches its
        // database handle module-globally, so the first install stays the
        // connected one and later installs only replace the global stub.
        idbControls?.values.clear();
        idbControls = installFakeIndexedDb();
        window.localStorage.clear();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        mocks.captureProjectRevision.mockReturnValue('revision-fixture');
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        // The live audio-buffer candidate; the characterization case is the
        // only place that overrides this to null.
        mocks.importCachedAudioBuffers.mockResolvedValue({
            persist: () => Promise.resolve(true),
            publish: () => undefined,
        });
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.getCrdtDoc.mockReturnValue({ tracks: { tracks: [] } });
        mocks.resetCrdtProjectAuthority.mockImplementation((_name, onAuthorityReplaced) => {
            onAuthorityReplaced?.();
        });
        resetLiveStoresToBlank();
    });

    it('the menu save-before-switch commits the saved project over the restored blank one', async () => {
        await saveProjectA();
        startBlankProjectB();
        await bootRestoreBlankProjectB();

        // The user edits the restored blank project before switching. Session 1
        // never saved the blank project at all, so whatever its named snapshot
        // ends up holding, only the menu's pre-switch save can have written it.
        renameProject(RENAMED_BLANK_NAME);

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(await screen.findByText(SAVED_PROJECT_NAME));

        await waitFor(
            () => {
                expect(projectStore.value?.name).toBe(SAVED_PROJECT_NAME);
            },
            { timeout: 2000 }
        );
        expect(projectStore.value?.createdAt).toBe(A_CREATED_AT);
        // The durable identity switched with the metadata: the loaded project
        // is A, not a blank authority reusing A's display name.
        expect(projectStore.value?.projectId).toBe(A_PROJECT_ID);
        expect(projectStore.value?.loading).toBe(false);
        expect(notifyUser).not.toHaveBeenCalled();

        // Pre-switch save witness: the blank project's named snapshot exists
        // on disk and carries the post-restore rename — nothing else in the
        // flow writes this key, and session 1 never saved the blank project
        // at all. It is read back through the real load path (the presentation
        // layer may not import the repository reader directly, and
        // loadRecentProject's first step IS that reader). The read-back leaves
        // the blank project active again, which is fine — it is the last
        // witness this case takes.
        const blankOutcome = await loadRecentProject(B_RECENT_KEY);
        expect(blankOutcome).toBe('committed');
        expect(projectStore.value?.name).toBe(RENAMED_BLANK_NAME);
        expect(projectStore.value?.createdAt).toBe(B_CREATED_AT);
        expect(
            getRecentProjects().some((entry) => entry.key === B_RECENT_KEY && entry.name === RENAMED_BLANK_NAME)
        ).toBe(true);
    });

    it('characterization: a null audio-buffer candidate stalls the switch silently (#2898)', async () => {
        await saveProjectA();
        // The same restored-blank workspace the committed case boots into,
        // modelled directly: after that case's explicit load activated, a
        // second yielding boot restore correctly stands down (see the header),
        // and the stall mechanism under test does not read the boot transition.
        startBlankProjectB();

        // The one focused seam override for this case: the load's audio-buffer
        // candidate resolves null. Everything else — the menu handler, the
        // pre-switch save, the load transaction machinery, and
        // replaceProjectData's abort path — is the same real code the
        // committed case above exercises.
        mocks.importCachedAudioBuffers.mockResolvedValue(null);

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(await screen.findByText(SAVED_PROJECT_NAME));

        await waitFor(() => expect(mocks.importCachedAudioBuffers).toHaveBeenCalledTimes(1));
        // Settle the aborted continuation (microtasks only — no timers run in
        // this flow).
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        // TODAY's behavior — the reproduced #2898 silent stall mechanism. The
        // null candidate drives replaceProjectData into its abort path,
        // loadRecentProject returns 'aborted', and handleLoad deliberately
        // does nothing for it: the active project stays on the blank one and
        // no error is surfaced anywhere. These assertions pin the silence;
        // they flip when the real fix lands, which is the point of this
        // characterization.
        expect(projectStore.value?.name).toBe(BLANK_PROJECT_NAME);
        expect(projectStore.value?.loading).toBe(false);
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
