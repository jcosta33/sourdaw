import { rootRevisionMatching } from './projectRevisionMatchesLiveIgnoringCommandCheckpoint';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutSaveTimestamp(projectMeta: unknown): unknown {
    if (!isRecord(projectMeta)) {
        return projectMeta;
    }
    const { updatedAt: _saveTimestamp, ...meta } = projectMeta;
    return meta;
}

/**
 * The active arrangement's entry copies the live slots (`tracks`, `automation`, `midi`, the tempo
 * and time-signature maps, `markers`, take lanes), which the comparison still reads on their own;
 * only its id and name are its own.
 */
function withoutActiveArrangementSnapshot(arrangements: unknown): unknown {
    if (!isRecord(arrangements) || !Array.isArray(arrangements.arrangements)) {
        return arrangements;
    }
    const activeId = arrangements.activeArrangementId;
    return {
        ...arrangements,
        arrangements: arrangements.arrangements.map((entry: unknown) =>
            isRecord(entry) && entry.id === activeId ? { id: entry.id, name: entry.name } : entry
        ),
    };
}

/**
 * What a save writes into root besides content: it stamps `projectMeta.updatedAt` before it
 * serializes, and refreshes the active arrangement's entry from the live slots
 * (`syncCurrentArrangementToStore`). Every other root field, those live slots included, still counts.
 */
function projectDocumentWithoutCommandCheckpointOrSaveWrites(
    document: Record<string, unknown>
): Record<string, unknown> {
    const projectDocument = rootRevisionMatching.withoutCommandCheckpoint(document);
    return {
        ...projectDocument,
        projectMeta: withoutSaveTimestamp(projectDocument.projectMeta),
        arrangements: withoutActiveArrangementSnapshot(projectDocument.arrangements),
    };
}

/**
 * As `projectRevisionMatchesLiveIgnoringCommandCheckpoint`, and also tolerating what a save writes
 * into root: the save timestamp (`projectMeta.updatedAt`) and the active arrangement's copy of the
 * live slots. A save between capture and check is then no project change, while every other
 * `projectMeta` field (name, key, scale, tuning, brief, identity), the live slots themselves and the
 * active arrangement's id and name still count. For a reader that only asks "is this still the same
 * project content"; command admission keeps the stricter check.
 */
export function projectRevisionMatchesLiveIgnoringSaveWrites(expectedRevision: string): boolean {
    return rootRevisionMatching.matchesLiveWithin(
        expectedRevision,
        projectDocumentWithoutCommandCheckpointOrSaveWrites
    );
}
