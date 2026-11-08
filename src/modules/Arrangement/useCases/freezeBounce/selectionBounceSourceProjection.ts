import { canonicalJson } from '#/utils/canonicalDigest';
import { isRecord } from '#/utils/structuralEquality';

// The storage writer omits undefined optional object properties. A
// staged store model and its prospective CRDT row share that read shape.
function publishedRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(value)
            .filter((entry) => entry[1] !== undefined)
            .map(([key, entry]) => [key, publishedValue(entry)])
    );
}
function publishedValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(publishedValue);
    }
    if (isRecord(value)) {
        return publishedRecord(value);
    }
    return value;
}

/** Only source facts consumed by the selected offline subgraph, not navigation or save copies. */
export function selectionBounceSourceProjection(trackIds: ReadonlySet<string>, clipIds: ReadonlySet<string>) {
    function rowsForClips(value: unknown): unknown {
        if (!isRecord(value)) {
            return value;
        }
        return Object.fromEntries(Object.entries(value).filter(([id]) => clipIds.has(id)));
    }
    function trackRows(value: unknown): unknown {
        if (!isRecord(value) || !Array.isArray(value.tracks)) {
            return value;
        }
        return value.tracks.map((track: unknown) => {
            if (!isRecord(track) || typeof track.id !== 'string' || trackIds.has(track.id)) {
                return track;
            }
            // Compensation walks every device and routing endpoint in the
            // session. An unrelated track's name, fader and clips do not enter it.
            return {
                id: track.id,
                parentId: track.parentId,
                devices: track.devices,
                sends: track.sends,
                outputId: track.outputId,
            };
        });
    }
    function automation(value: unknown): unknown {
        if (!isRecord(value) || !Array.isArray(value.lanes)) {
            return value;
        }
        return value.lanes.filter(
            (lane: unknown) => !isRecord(lane) || typeof lane.trackId !== 'string' || trackIds.has(lane.trackId)
        );
    }
    function midiSource(value: unknown): unknown {
        if (!isRecord(value)) {
            return value;
        }
        return {
            probabilitySeed: value.probabilitySeed,
            notesByClipId: rowsForClips(value.notesByClipId),
            ccByClipId: rowsForClips(value.ccByClipId),
            pitchBendByClipId: rowsForClips(value.pitchBendByClipId),
        };
    }
    function transportSource(value: unknown): unknown {
        if (!isRecord(value)) {
            return value;
        }
        return {
            tempo: value.tempo,
            timeSignatureNumerator: value.timeSignatureNumerator,
            timeSignatureDenominator: value.timeSignatureDenominator,
            scheduleGrainMs: value.scheduleGrainMs,
        };
    }
    return (rawDocument: Readonly<Record<string, unknown>>): Record<string, unknown> => {
        const document = rawDocument;
        const midi = document.midi;
        const transport = document.transport;
        const arrangements = document.arrangements;
        return {
            source: canonicalJson(
                publishedRecord({
                    tracks: trackRows(document.tracks),
                    midi: midiSource(midi),
                    transport: transportSource(transport),
                    tempoMap: document.tempoMap,
                    timeSignatureMap: document.timeSignatureMap,
                    automation: automation(document.automation),
                    takeLanes: document.takeLanes,
                    gainEnvelopes: rowsForClips(
                        isRecord(document.gainEnvelopes) ? document.gainEnvelopes.envelopes : document.gainEnvelopes
                    ),
                    sidechainRoutes: document.sidechainRoutes,
                    vcaGroups: document.vcaGroups,
                    adjustmentLayers: document.adjustmentLayers,
                    grooveTemplates: document.grooveTemplates,
                    chordTrack: document.chordTrack,
                    yeast: document.yeast,
                    projectCreatedAt: isRecord(document.projectMeta)
                        ? document.projectMeta.createdAt
                        : document.projectMeta,
                    activeArrangementId: isRecord(arrangements) ? arrangements.activeArrangementId : arrangements,
                })
            ),
        };
    };
}
