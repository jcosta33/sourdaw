import { compileAudioGraphTopology } from '#/modules/AudioEngine/useCases';

import {
    AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
    type AgentDomainPreviewInput,
    type AgentDomainPreviewResult,
} from '../../models/AgentDomainPreview';
import {
    readProjectedEntries,
    readProjectedNumber,
    readProjectedSlot,
    readProjectedString,
} from '../../services/projectedDocumentSlot';

/**
 * The compiled routing and device topology of the projected post-state.
 *
 * The whole projected graph is compiled rather than the batch's own edges,
 * because a routed change is only valid against the tracks, sends and sidechain
 * routes that surround it. The `tracks` slot is required; a project legitimately
 * carries no `sidechainRoutes` slot and compiles with none.
 */

type ProjectedTrack = {
    readonly devices: readonly { readonly id: string; readonly type: string }[];
    readonly id: string;
    readonly kind: string;
    readonly outputId?: string;
    readonly sends: readonly { readonly busId: string; readonly level: number }[];
};

type ProjectedSidechainRoute = {
    readonly sourceTrackId: string;
    readonly targetDeviceId: string;
    readonly targetTrackId: string;
};

function projectedDevices(track: Readonly<Record<string, unknown>>): ProjectedTrack['devices'] {
    return (readProjectedEntries(track, 'devices') ?? []).flatMap((device) => {
        const id = readProjectedString(device, 'id');
        const type = readProjectedString(device, 'type');
        if (id === null || type === null) {
            return [];
        }
        return [{ id, type }];
    });
}

function projectedSends(track: Readonly<Record<string, unknown>>): ProjectedTrack['sends'] {
    return (readProjectedEntries(track, 'sends') ?? []).flatMap((send) => {
        const busId = readProjectedString(send, 'busId');
        const level = readProjectedNumber(send, 'level');
        if (busId === null || level === null) {
            return [];
        }
        return [{ busId, level }];
    });
}

function projectedTracks(document: Readonly<Record<string, unknown>>): readonly ProjectedTrack[] | null {
    const tracksSlot = readProjectedSlot(document, 'tracks');
    const tracks = tracksSlot === null ? null : readProjectedEntries(tracksSlot, 'tracks');
    if (tracks === null) {
        return null;
    }
    return tracks.flatMap((track) => {
        const id = readProjectedString(track, 'id');
        const kind = readProjectedString(track, 'kind');
        if (id === null || kind === null) {
            return [];
        }
        const outputId = readProjectedString(track, 'outputId');
        const projected = { devices: projectedDevices(track), id, kind, sends: projectedSends(track) };
        if (outputId === null) {
            return [projected];
        }
        return [{ ...projected, outputId }];
    });
}

function projectedSidechainRoutes(document: Readonly<Record<string, unknown>>): readonly ProjectedSidechainRoute[] {
    const routesSlot = readProjectedSlot(document, 'sidechainRoutes');
    const routes = routesSlot === null ? null : readProjectedEntries(routesSlot, 'routes');
    return (routes ?? []).flatMap((route) => {
        const sourceTrackId = readProjectedString(route, 'sourceTrackId');
        const targetDeviceId = readProjectedString(route, 'targetDeviceId');
        const targetTrackId = readProjectedString(route, 'targetTrackId');
        if (sourceTrackId === null || targetDeviceId === null || targetTrackId === null) {
            return [];
        }
        return [{ sourceTrackId, targetDeviceId, targetTrackId }];
    });
}

export function previewDeviceGraph(input: AgentDomainPreviewInput): AgentDomainPreviewResult {
    const tracks = projectedTracks(input.projectDocument);
    if (tracks === null) {
        return { status: 'unsupported', domain: 'device-graph', reason: 'projection-slot-missing' };
    }
    const compiled = compileAudioGraphTopology({
        sidechainRoutes: projectedSidechainRoutes(input.projectDocument),
        tracks,
    });
    if (compiled.status === 'invalid') {
        return { status: 'unsupported', domain: 'device-graph', reason: 'graph-invalid' };
    }
    return {
        status: 'previewed',
        domain: 'device-graph',
        schemaVersion: AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
        handle: { edgeCount: compiled.edgeCount, nodeIds: compiled.nodeIds },
    };
}
