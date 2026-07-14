type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type NormalizeLegacyProjectDataOutput = unknown;

export function normalizeLegacyProjectData(value: unknown): NormalizeLegacyProjectDataOutput {
    if (!isRecord(value) || value.meta !== undefined || value.arrangement !== undefined) {
        return value;
    }
    if (value.version !== 1 || typeof value.name !== 'string' || !isRecord(value.tracks)) {
        return value;
    }

    const markerState = isRecord(value.markers) ? value.markers : undefined;
    const markers = Array.isArray(markerState?.markers) ? markerState.markers : [];
    const arrangementId = 'legacy-arrangement';
    const arrangements = Array.isArray(value.arrangements)
        ? value.arrangements
        : [
              {
                  id: arrangementId,
                  name: 'Arrangement 1',
                  tracks: value.tracks,
                  automation: value.automation,
                  midi: value.midi,
                  tempoMap: value.tempoMap,
                  timeSignatureMap: value.timeSignatureMap,
                  markers: markerState,
                  takeLanes: value.takeLanes,
              },
          ];
    const activeArrangementId =
        typeof value.activeArrangementId === 'string' ? value.activeArrangementId : arrangementId;

    return {
        version: value.version,
        meta: {
            name: value.name,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        transport: value.transport,
        arrangement: { tracks: value.tracks.tracks },
        automation: value.automation,
        midi: value.midi,
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers,
        tempoMap: value.tempoMap,
        timeSignatureMap: value.timeSignatureMap,
        takeLanes: value.takeLanes,
        sidechainRoutes: value.sidechainRoutes,
        arrangements,
        activeArrangementId,
        history: { checkpoints: [] },
    };
}
