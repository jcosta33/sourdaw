import {
    captureAutomergeStoragePreparationScope,
    captureAutomergeStorageTransactionScope,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, takeLaneStore, trackStore, warpStateStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    getCrdtDoc,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { type HandlerCommitValidation, type HandlerExecutionResult } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { isCanonicalProjectId } from '../../../models/ProjectData';
import { arrangementStore, prepareArrangementStoreState } from '../../../stores/arrangementStore';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { getSettledProjectId, projectStore, readSettledProjectId } from '../../../stores/projectStore';
import { takeSnapshot } from '../../arrangement/takeSnapshot';

/** Only a still-open, same-project preparation may be replanned by its caller. */
export class ProjectSavePreparationStaleError extends Error {
    constructor() {
        super('Project Save inputs changed during preparation');
        this.name = 'ProjectSavePreparationStaleError';
    }
}

function sourceValues(): readonly unknown[] {
    return [
        trackStore.value,
        automationStore.value,
        midiStore.value,
        tempoMapStore.value,
        timeSignatureMapStore.value,
        markerStore.value,
        takeLaneStore.value,
        warpStateStore.value,
    ];
}

function canonicalValue(value: unknown): unknown {
    const json = JSON.stringify(value);
    if (json === undefined) {
        throw new Error('Project Save preparation requires a serializable value');
    }
    const result: unknown = JSON.parse(json);
    return result;
}

function requireOutgoingProjectId(expectedOutgoingProjectIdentity: string): string {
    if (captureProjectIdentity() !== expectedOutgoingProjectIdentity) {
        throw new Error('Project authority changed during Save preparation');
    }

    const project = projectStore.value;
    if (!project || project.identityMigrationPending !== false || !isCanonicalProjectId(project.projectId)) {
        throw new Error('Project Save preparation requires settled project identity');
    }
    const metadata = getCrdtDoc('root')?.projectMeta;
    if (
        !isRecord(metadata) ||
        readSettledProjectId(metadata) !== project.projectId ||
        metadata.createdAt !== project.createdAt
    ) {
        throw new Error('Project Save preparation requires matching outgoing project metadata');
    }
    return project.projectId;
}

function assertAvailable(signal: AbortSignal, expectedOutgoingProjectIdentity: string | undefined): string {
    signal.throwIfAborted();
    if (agentProjectRepairStateStore.value !== null || projectLoadFailureStore.value !== null) {
        throw new Error('Project Save preparation requires a healthy loaded project');
    }
    if (expectedOutgoingProjectIdentity !== undefined) {
        return requireOutgoingProjectId(expectedOutgoingProjectIdentity);
    }
    const projectId = getSettledProjectId();
    if (!projectId || projectStore.value?.loading) {
        throw new Error('Project Save preparation requires settled project identity');
    }
    return projectId;
}

function createSaveCommitValidation(
    assertCurrent: () => void,
    arrangements: unknown,
    projectMeta: unknown
): HandlerCommitValidation {
    return {
        beforeCommit: () => {
            assertCurrent();
            return null;
        },
        documentId: 'root',
        validateDocument: (document) => {
            assertCurrent();
            return valuesEqual(document.arrangements, arrangements) && valuesEqual(document.projectMeta, projectMeta)
                ? null
                : 'Prepared Save snapshot or metadata changed before publication';
        },
        release: () => undefined,
    };
}

/**
 * Prepare the Save-owned snapshot under the caller's existing transaction.
 * This stages only; Command retains final validation, publication and abort.
 * The outgoing take Save carries its pre-switch native identity through loading.
 */
export async function prepareProjectSaveSnapshot(
    signal: AbortSignal = new AbortController().signal,
    expectedOutgoingProjectIdentity?: string
): Promise<HandlerExecutionResult> {
    const preparationScope = captureAutomergeStoragePreparationScope();
    const scope = captureAutomergeStorageTransactionScope();
    if (!preparationScope) {
        throw new Error('Project Save preparation requires an open owning transaction');
    }
    assertAvailable(signal, expectedOutgoingProjectIdentity);
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const identity = captureProjectIdentity();
    const root = getCrdtDoc('root');
    const project = projectStore.value;
    const arrangements = arrangementStore.value;
    if (!root || !project || !arrangements || !isRecord(root.projectMeta)) {
        throw new Error('Project Save preparation requires native project metadata and arrangements');
    }
    const projectId =
        expectedOutgoingProjectIdentity === undefined
            ? getSettledProjectId()
            : assertAvailable(signal, expectedOutgoingProjectIdentity);
    const sources = sourceValues();
    let expectedProject = project;
    let expectedArrangements = arrangements;
    const updatedAt = Date.now();
    const nextProject = { ...project, updatedAt, dirty: true };
    const nextArrangements = {
        ...arrangements,
        arrangements: arrangements.arrangements.map((snapshot) =>
            snapshot.id === arrangements.activeArrangementId ? takeSnapshot(snapshot.id, snapshot.name) : snapshot
        ),
    };
    const canonicalArrangements = canonicalValue(nextArrangements);
    const canonicalProject = canonicalValue(nextProject);
    const expectedNativeMetadata = { ...root.projectMeta, updatedAt };

    function assertCurrent(): void {
        const currentProjectId = assertAvailable(signal, expectedOutgoingProjectIdentity);
        if (captureProjectIdentity() !== identity || currentProjectId !== projectId) {
            throw new Error('Project authority changed during Save preparation');
        }
        if (
            captureProjectRevision() !== revision ||
            projectStore.value !== expectedProject ||
            arrangementStore.value !== expectedArrangements ||
            sourceValues().some((value, index) => value !== sources[index])
        ) {
            throw new ProjectSavePreparationStaleError();
        }
    }

    function assertPreparationCurrent(): void {
        // Preparing may re-enter only an open owner. Commit validators run
        // after storage has closed that scope and must inspect without re-entry.
        scope(assertCurrent);
    }

    const refresh = !valuesEqual(canonicalValue(arrangements), canonicalArrangements);
    const plan = refresh ? prepareArrangementStoreState(preparationScope, nextArrangements) : undefined;
    if (refresh && !plan) {
        throw new Error('Bounded native Save snapshot preparation is unavailable');
    }
    try {
        assertPreparationCurrent();
        if (plan) {
            plan.clone();
            const request = plan.requestMaterialization;
            if (!request) {
                throw new Error('Bounded native Save snapshot Worker is unavailable');
            }
            try {
                await request(signal);
            } catch (error) {
                assertPreparationCurrent();
                throw error;
            }
            assertPreparationCurrent();
            scope(() => plan.materialize());
        }
        assertPreparationCurrent();
        scope(() => {
            projectStore.set(nextProject);
            if (!valuesEqual(projectStore.value, canonicalProject)) {
                throw new ProjectSavePreparationStaleError();
            }
            expectedProject = projectStore.value;
            assertCurrent();
            if (plan && !plan.stage()) {
                throw new ProjectSavePreparationStaleError();
            }
            if (!valuesEqual(arrangementStore.value, canonicalArrangements)) {
                throw new ProjectSavePreparationStaleError();
            }
            expectedArrangements = arrangementStore.value;
            assertCurrent();
        });
        return {
            status: 'written',
            commitValidation: createSaveCommitValidation(assertCurrent, canonicalArrangements, expectedNativeMetadata),
        };
    } finally {
        plan?.discard();
    }
}
