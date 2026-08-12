import { beforeEach, describe, expect, it } from 'vitest';

import { clipSelectionStore, defaultTrackState, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import { createCrdtProject } from '#/modules/CrdtDocument/useCases';
import { sidechainStore } from '#/modules/Routing/stores';
import {
    defaultTransportState,
    tempoMapStore,
    timeSignatureMapStore,
    transportStore,
} from '#/modules/Transport/stores';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { getSemanticProjectIndexDiagnostics } from '../getSemanticProjectIndexDiagnostics';
import { querySemanticProject } from '../semanticProjectQueries';

function seedProject(): void {
    const drums = createTrack({ id: 'track-drums', name: 'Drums', kind: 'audio' });
    const bass = createTrack({ id: 'track-bass', name: 'Bass DI', kind: 'audio' });
    const bus = createTrack({ id: 'bus-drums', name: 'Drum Bus', kind: 'bus' });
    drums.outputId = bus.id;
    drums.clips = [
        {
            id: 'clip-drums-verse',
            trackId: drums.id,
            name: 'Verse drums',
            startBeat: 0,
            endBeat: 16,
            type: 'audio',
            audioBufferId: 'buffer-drums',
            assetHash: 'asset-drums',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: true,
            muted: false,
        },
    ];
    bass.devices = [
        {
            id: 'device-bass-comp',
            name: 'Compressor',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -18 },
        },
    ];
    bass.clips = [
        {
            id: 'clip-bass-chorus',
            trackId: bass.id,
            name: 'Chorus bass',
            startBeat: 16,
            endBeat: 24,
            type: 'audio',
            audioBufferId: 'buffer-bass',
            assetHash: 'asset-bass',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        },
    ];
    bass.sends = [{ busId: bus.id, level: 0.4, preFader: false }];

    setTrackStoreState({
        ...structuredClone(defaultTrackState),
        tracks: [drums, bass, bus],
        selectedTrackId: bass.id,
    });
    clipSelectionStore.set({
        selectedClipId: drums.clips[0]!.id,
        selectedClipIds: [drums.clips[0]!.id],
        marqueeSelection: null,
    });
    markerStore.set({
        markers: [{ id: 'marker-chorus', name: 'Chorus hit', beat: 16, color: '#fff' }],
        sections: [
            { id: 'section-verse', name: 'Verse One', startBeat: 0, endBeat: 16, color: '#111' },
            { id: 'section-chorus', name: 'Chorus One', startBeat: 16, endBeat: 32, color: '#222' },
        ],
    });
    automationStore.set({
        lanes: [
            {
                id: 'lane-bass-gain',
                trackId: bass.id,
                parameterId: 'gain',
                parameterName: 'Gain',
                minValue: 0,
                maxValue: 1,
                enabled: true,
                visible: true,
                collapsed: false,
                points: [{ id: 'point-bass', beat: 20, value: 0.8, curve: 'linear', tension: 0 }],
                objects: [],
            },
        ],
    });
    sidechainStore.set({
        routes: [
            {
                id: 'route-kick-bass',
                sourceTrackId: drums.id,
                targetTrackId: bass.id,
                targetDeviceId: 'device-bass-comp',
                targetParameterId: 'sidechain',
                gain: 1,
            },
        ],
    });
    transportStore.set({
        ...structuredClone(defaultTransportState),
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    });
    tempoMapStore.set({ changes: [{ id: 'tempo-chorus', beat: 16, tempo: 124, curve: 'linear' }] });
    timeSignatureMapStore.set({
        changes: [{ id: 'meter-chorus', beat: 16, numerator: 6, denominator: 8 }],
    });
    actionHistoryStore.set({
        entries: [
            {
                id: 'history-route',
                label: 'Route drums',
                actionKind: 'setTrackOutput',
                source: 'ai',
                timestamp: 200,
                reverted: false,
            },
        ],
    });
    const productionBrief = createDefaultProductionBrief(100);
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        name: 'Semantic Query Project',
        createdAt: 42,
        updatedAt: 200,
        productionBrief: {
            ...productionBrief,
            revision: 3,
            trackRoles: [{ id: 'role-bass', trackId: bass.id, role: 'bass', createdAt: 110 }],
            locks: [
                {
                    id: 'lock-verse',
                    scope: { kind: 'section', sectionId: 'section-verse' },
                    statement: 'Keep Verse One fixed',
                    createdAt: 120,
                },
            ],
            decisions: [
                {
                    id: 'decision-bass',
                    scope: { kind: 'track', trackId: bass.id },
                    statement: 'Keep bass centered',
                    rationale: null,
                    status: 'locked',
                    sourceRunId: 'run-1',
                    relatedBatchId: null,
                    supersededByDecisionId: null,
                    createdAt: 130,
                },
            ],
            unresolvedQuestions: [{ id: 'question-1', statement: 'Confirm the outro length', createdAt: 140 }],
        },
    });
}

describe('semantic project queries', () => {
    beforeEach(async () => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        await createCrdtProject('Semantic Query Project');
        seedProject();
    });

    it('returns schema-versioned revision receipts with bounded stale-safe pagination', async () => {
        const first = querySemanticProject({
            type: 'object',
            filters: { kind: 'track' },
            page: { limit: 1 },
        });

        expect(first).toMatchObject({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: '42',
            projectSchemaVersion: 1,
            queryType: 'object',
            page: { limit: 1, total: 3 },
        });
        const rootRevision = first.revision.documents.find((document) => document.docId === 'root');
        expect(rootRevision).toBeDefined();
        expect(Array.isArray(rootRevision?.heads)).toBe(true);
        expect(first.items).toHaveLength(1);
        expect(first.nextCursor).toEqual(expect.any(String));
        expect(() => querySemanticProject({ type: 'object', page: { limit: 51 } })).toThrow('page limit');
        expect(() => querySemanticProject({ type: 'object', filters: { minInferredConfidence: 2 } })).toThrow(
            'confidence'
        );

        const second = querySemanticProject({
            type: 'object',
            filters: { kind: 'track' },
            page: { limit: 1, cursor: first.nextCursor! },
        });
        expect(second.items).toHaveLength(1);
        expect(second.items[0]).not.toEqual(first.items[0]);

        await executeAppAction({
            type: 'setTrackGain',
            payload: { trackId: 'track-bass', gain: 0.65, expectedGain: 0.8 },
        });
        expect(() =>
            querySemanticProject({
                type: 'object',
                filters: { kind: 'track' },
                page: { limit: 1, cursor: first.nextCursor! },
            })
        ).toThrow('stale semantic query cursor');
    });

    it('supports every query family, filters, and hierarchical production context', () => {
        const summary = querySemanticProject({ type: 'project-summary' });
        expect(summary.items).toHaveLength(1);
        expect(summary.items[0]).toMatchObject({
            name: 'Semantic Query Project',
            tempo: 120,
            meter: [4, 4],
            selection: { trackId: 'track-bass', clipIds: ['clip-drums-verse'] },
            warnings: ['Confirm the outro length'],
        });
        const summaryItem = summary.items[0]!;
        expect(summaryItem.sections).toContainEqual(expect.objectContaining({ id: 'section-chorus' }));
        expect(summaryItem.tracks).toContainEqual(
            expect.objectContaining({
                id: 'track-bass',
                roles: ['bass'],
                deviceTypes: ['builtin-compressor'],
                outputId: 'master',
                sendBusIds: ['bus-drums'],
            })
        );
        expect(summaryItem.locks).toContainEqual(expect.objectContaining({ id: 'lock-verse' }));
        expect(summaryItem.decisions).toContainEqual(
            expect.objectContaining({ id: 'decision-bass', status: 'locked' })
        );

        expect(querySemanticProject({ type: 'selection' }).items.map((item) => item.id)).toEqual([
            'track-bass',
            'clip-drums-verse',
        ]);
        const fuzzyMatches = querySemanticProject({
            type: 'object',
            filters: {
                fuzzyName: 'bas di',
                role: 'bass',
                deviceType: 'builtin-compressor',
                hasAutomation: true,
                routeToId: 'bus-drums',
                minInferredConfidence: 0.6,
            },
        }).items;
        expect(fuzzyMatches.map((item) => item.id)).toEqual(['track-bass']);
        expect(fuzzyMatches[0]?.inferredConfidence).toBeGreaterThanOrEqual(0.6);
        function objectIds(filters: Parameters<typeof querySemanticProject>[0]['filters']): string[] {
            return querySemanticProject({ type: 'object', filters }).items.map((item) => item.id);
        }
        expect(objectIds({ stableId: 'device-bass-comp' })).toEqual(['device-bass-comp']);
        expect(objectIds({ exactName: 'VERSE DRUMS', contentType: 'audio', assetType: 'managed-audio' })).toEqual([
            'clip-drums-verse',
        ]);
        expect(objectIds({ tag: 'bass', selected: true, muted: false, soloed: false })).toEqual(['track-bass']);
        expect(objectIds({ parentId: 'track-drums', sectionId: 'section-verse', locked: true })).toContain(
            'clip-drums-verse'
        );
        expect(objectIds({ stableId: 'marker-chorus', locked: true })).toEqual([]);
        expect(objectIds({ stableId: 'marker-chorus', locked: false })).toEqual(['marker-chorus']);
        expect(objectIds({ kind: 'clip', startBeat: 16, endBeat: 32 })).toEqual(['clip-bass-chorus']);
        expect(objectIds({ deviceCategory: 'effect', kind: 'device' })).toEqual(['device-bass-comp']);
        expect(objectIds({ routeFromId: 'track-drums', hasAutomation: true })).toContain('track-bass');
        expect(querySemanticProject({ type: 'routing-graph' }).items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'route-kick-bass', kind: 'sidechain-route' }),
                expect.objectContaining({ id: 'track-drums:output', targetId: 'bus-drums' }),
                expect.objectContaining({ id: 'track-bass:send:bus-drums', kind: 'send' }),
            ])
        );
        expect(querySemanticProject({ type: 'section', filters: { sectionId: 'section-chorus' } }).items).toEqual([
            expect.objectContaining({
                id: 'section-chorus',
                clipIds: ['clip-bass-chorus'],
                automationLaneIds: ['lane-bass-gain'],
                markerIds: ['marker-chorus'],
            }),
        ]);
        expect(querySemanticProject({ type: 'tempo' }).items).toEqual([
            expect.objectContaining({ id: 'tempo-base', tempo: 120, meter: [4, 4] }),
            expect.objectContaining({ id: 'tempo-chorus', tempo: 124 }),
            expect.objectContaining({ id: 'meter-chorus', meter: [6, 8] }),
        ]);
        expect(querySemanticProject({ type: 'history' }).items).toEqual([
            expect.objectContaining({ id: 'history-route', actionKind: 'setTrackOutput' }),
        ]);
    });

    it('rebuilds only changed index partitions and returns stable-ID diffs', () => {
        const before = querySemanticProject({ type: 'project-summary' });
        const initialDiagnostics = getSemanticProjectIndexDiagnostics();
        const tracks = trackStore.value!.tracks.map((track) =>
            track.id === 'track-bass' ? { ...track, gain: 0.65 } : track
        );
        setTrackStoreState({ ...trackStore.value!, tracks });

        const diff = querySemanticProject({
            type: 'diff',
            sinceRevision: before.revisionToken,
            filters: { stableId: 'track-bass', kind: 'track' },
        });
        const unrelatedDiff = querySemanticProject({
            type: 'diff',
            sinceRevision: before.revisionToken,
            filters: { stableId: 'track-drums' },
        });
        const afterDiagnostics = getSemanticProjectIndexDiagnostics();

        expect(diff.items).toEqual([expect.objectContaining({ id: 'track-bass', change: 'updated', kind: 'track' })]);
        expect(unrelatedDiff.items).toEqual([]);
        expect(afterDiagnostics.tracks).toBe(initialDiagnostics.tracks + 1);
        expect(afterDiagnostics.sections).toBe(initialDiagnostics.sections);
        expect(afterDiagnostics.routing).toBe(initialDiagnostics.routing);
        expect(afterDiagnostics.history).toBe(initialDiagnostics.history);
    });

    it('indexes project and selection changes without rebuilding unrelated partitions', () => {
        const before = querySemanticProject({ type: 'project-summary' });
        const initialDiagnostics = getSemanticProjectIndexDiagnostics();

        clipSelectionStore.set({
            selectedClipId: 'stale-clip-id',
            selectedClipIds: ['stale-clip-id'],
            marqueeSelection: null,
        });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4 });
        const selectionReceipt = querySemanticProject({ type: 'project-summary' });
        const selectionDiff = querySemanticProject({ type: 'diff', sinceRevision: before.revisionToken });
        const selectionDiagnostics = getSemanticProjectIndexDiagnostics();

        expect(selectionReceipt.revisionToken).not.toBe(before.revisionToken);
        expect(selectionDiff.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'project-selection', kind: 'selection', change: 'updated' }),
                expect.objectContaining({ id: 'clip-drums-verse', kind: 'clip', change: 'updated' }),
            ])
        );
        expect(selectionDiagnostics.selection).toBe(initialDiagnostics.selection + 1);
        expect(selectionDiagnostics.tracks).toBe(initialDiagnostics.tracks);
        expect(selectionDiagnostics.tempo).toBe(initialDiagnostics.tempo);

        clipSelectionStore.set({
            selectedClipId: 'another-stale-clip-id',
            selectedClipIds: ['another-stale-clip-id'],
            marqueeSelection: null,
        });
        const staleSelectionReceipt = querySemanticProject({ type: 'project-summary' });
        const staleSelectionDiff = querySemanticProject({
            type: 'diff',
            sinceRevision: selectionReceipt.revisionToken,
        });
        expect(staleSelectionReceipt.revisionToken).not.toBe(selectionReceipt.revisionToken);
        expect(staleSelectionDiff.items).toEqual([
            expect.objectContaining({ id: 'project-selection', kind: 'selection', change: 'updated' }),
        ]);

        const project = projectStore.value!;
        projectStore.set({
            ...project,
            name: 'Renamed Semantic Project',
            productionBrief: {
                ...project.productionBrief,
                unresolvedQuestions: [
                    ...project.productionBrief.unresolvedQuestions,
                    { id: 'question-2', statement: 'Confirm the ending', createdAt: 220 },
                ],
            },
        });
        const projectDiff = querySemanticProject({
            type: 'diff',
            sinceRevision: staleSelectionReceipt.revisionToken,
        });
        expect(projectDiff.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: '42', kind: 'project-metadata', change: 'updated' }),
                expect.objectContaining({ id: 'production-brief', kind: 'production-brief', change: 'updated' }),
            ])
        );
    });

    it('bounds nested values and clears retained diffs across project identities', async () => {
        const current = projectStore.value!;
        projectStore.set({
            ...current,
            productionBrief: {
                ...current.productionBrief,
                unresolvedQuestions: [{ id: 'question-large', statement: 'x'.repeat(3_000), createdAt: 210 }],
            },
        });
        const before = querySemanticProject({ type: 'project-summary' });
        expect(before.warnings.every((warning) => warning.length <= 2_048)).toBe(true);

        await createCrdtProject('Different Project');
        seedProject();
        const diff = querySemanticProject({ type: 'diff', sinceRevision: before.revisionToken });
        expect(diff.items).toEqual([]);
        expect(diff.warnings).toContain('The requested revision is outside the retained semantic diff window.');
    });
});
