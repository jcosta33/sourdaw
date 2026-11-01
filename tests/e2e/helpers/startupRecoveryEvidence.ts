import { expect, type Frame } from '@playwright/test';

import type { AppAction } from '../../../src/utils/handlerContract';

type Clip = {
    id: string;
    trackId: string;
    name: string;
    type: string;
    startBeat: number;
    endBeat: number;
    audioBufferId?: string;
    loopOriginBeat?: number;
};
type Track = { id: string; name: string; clips: Clip[] };
type MirroredEntry = {
    kind: string;
    groupId?: string;
    action?: AppAction;
    inverseAction?: AppAction;
    redoAction?: AppAction;
};
type Mirror = { projectId?: string; witness?: string; past: MirroredEntry[]; future: MirroredEntry[] };
type Snapshot = {
    projectId: string;
    witness: string;
    tracks: Track[];
    mirror: Mirror;
    exact: unknown;
    inspection: { projectInvariantsValid: boolean; audioGraphValid: boolean };
    counts: { notes: number; controllers: number; takes: number; compRegions: number; automationPoints: number };
};

export async function readStartupSnapshot(page: Frame): Promise<Snapshot> {
    const serializedSnapshot = await page.evaluate(async () => {
        const arrangementPath = '/src/modules/Arrangement/stores/index.ts';
        const midiPath = '/src/modules/MIDI/stores/index.ts';
        const automationPath = '/src/modules/Automation/stores/index.ts';
        const projectPath = '/src/modules/Project/stores/index.ts';
        const crdtPath = '/src/modules/CrdtDocument/useCases/index.ts';
        const inspectionPath = '/src/modules/CrdtDocument/useCases/agentProjectInspectionPort.ts';
        const audioPath = '/src/modules/AudioEngine/useCases/index.ts';
        const arrangement: typeof import('../../../src/modules/Arrangement/stores') = await import(arrangementPath);
        const midi: typeof import('../../../src/modules/MIDI/stores') = await import(midiPath);
        const automation: typeof import('../../../src/modules/Automation/stores') = await import(automationPath);
        const project: typeof import('../../../src/modules/Project/stores') = await import(projectPath);
        const crdt: typeof import('../../../src/modules/CrdtDocument/useCases') = await import(crdtPath);
        const {
            agentProjectInspectionPort,
        }: typeof import('../../../src/modules/CrdtDocument/useCases/agentProjectInspectionPort') = await import(
            inspectionPath
        );
        const audio: typeof import('../../../src/modules/AudioEngine/useCases') = await import(audioPath);
        const document = crdt.getCrdtDoc('root');
        const projectState = project.projectStore.value;
        const tracks = arrangement.trackStore.value?.tracks;
        if (!document || !tracks || !projectState?.projectId || !projectState.initialized || projectState.loading) {
            throw new Error('The actual saved project has not hydrated');
        }
        if (!agentProjectInspectionPort.isConfigured()) {
            throw new Error('Production project inspection is not configured');
        }
        const inspection = agentProjectInspectionPort.inspect({ projectDocument: document, targetIds: [] });
        if (!inspection) {
            throw new Error('Production project inspection returned no evidence');
        }
        const witness = crdt.captureDurableDocumentWitness();
        const rootTracks = document.tracks;
        if (typeof rootTracks !== 'object' || rootTracks === null || !('tracks' in rootTracks)) {
            throw new Error('Raw track ownership is absent');
        }
        // UI selection and project save timestamps are not clip-edit content.
        const exact = {
            raw: {
                tracks: rootTracks.tracks,
                midi: document.midi,
                automation: document.automation,
                takeLanes: document.takeLanes,
                gainEnvelopes: document.gainEnvelopes,
            },
            projected: {
                tracks,
                midi: midi.midiStore.value,
                automation: automation.automationStore.value,
                takeLanes: arrangement.takeLaneStore.value,
                gainEnvelopes: arrangement.gainEnvelopeStore.value,
            },
        };
        const bufferIds = [
            ...new Set(
                tracks
                    .flatMap((track) => track.clips)
                    .flatMap((clip) => (clip.audioBufferId ? [clip.audioBufferId] : []))
            ),
        ].sort();
        const pcm = [];
        for (const bufferId of bufferIds) {
            const buffer = audio.getCachedAudioBuffer({ bufferId });
            if (!buffer) {
                throw new Error(`Hydrated source PCM is unavailable: ${bufferId}`);
            }
            const channels = [];
            for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
                const data = buffer.getChannelData(channel).slice();
                const digest = await crypto.subtle.digest('SHA-256', data.buffer);
                channels.push(
                    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
                );
            }
            pcm.push({ bufferId, sampleRate: buffer.sampleRate, frames: buffer.length, channels });
        }
        if (crdt.captureDurableDocumentWitness() !== witness) {
            throw new Error('Project changed while reading acceptance evidence');
        }
        const serialized = sessionStorage.getItem('sourdaw-undo-session');
        if (!serialized) {
            throw new Error('Production session action mirror is absent');
        }
        return JSON.stringify({
            projectId: projectState.projectId,
            witness,
            tracks,
            mirror: JSON.parse(serialized),
            exact: { ...exact, pcm },
            inspection,
            counts: {
                notes: Object.values(midi.midiStore.value?.notesByClipId ?? {}).flat().length,
                controllers: Object.values(midi.midiStore.value?.ccByClipId ?? {}).flat().length,
                takes: arrangement.takeLaneStore.value?.lanes.flatMap((lane) => lane.takes).length ?? 0,
                compRegions:
                    arrangement.takeLaneStore.value?.lanes.flatMap((lane) => lane.activeCompRegions).length ?? 0,
                automationPoints: automation.automationStore.value?.lanes.flatMap((lane) => lane.points).length ?? 0,
            },
        });
    });
    return JSON.parse(serializedSnapshot);
}

export async function expectStartupExact(page: Frame, expected: Snapshot): Promise<Snapshot> {
    await expect
        .poll(
            () =>
                page.evaluate(async (projectId: string) => {
                    const path = '/src/modules/Project/stores/index.ts';
                    const { projectStore }: typeof import('../../../src/modules/Project/stores') = await import(path);
                    const state = projectStore.value;
                    return state?.initialized === true && state.loading === false && state.projectId === projectId;
                }, expected.projectId),
            { timeout: 30_000 }
        )
        .toBe(true);
    await expect.poll(async () => (await readStartupSnapshot(page)).exact, { timeout: 30_000 }).toEqual(expected.exact);
    const actual = await readStartupSnapshot(page);
    expect(actual.projectId).toBe(expected.projectId);
    expect(actual.inspection).toMatchObject({ projectInvariantsValid: true, audioGraphValid: true });
    return actual;
}

export function requireStartupMirror(
    snapshot: Snapshot,
    side: 'past' | 'future',
    types: string[],
    removeRipple = false
): MirroredEntry[] {
    expect(snapshot.mirror.projectId).toBe(snapshot.projectId);
    expect(snapshot.mirror.witness).toBe(snapshot.witness);
    const entries =
        side === 'past' ? snapshot.mirror.past.slice(-types.length) : snapshot.mirror.future.slice(0, types.length);
    expect(entries.map((entry) => entry.action?.type).sort()).toEqual([...types].sort());
    for (const entry of entries) {
        expect(entry.kind).toBe('action');
        expect(entry.inverseAction?.type).toBeTruthy();
        if (entry.action?.type === 'removeClip') {
            // New removal entries bind their actual forward Ripple choice.
            // Legacy entries without this metadata remain covered by unit tests.
            expect(entry.inverseAction?.type).toBe('restoreClip');
            expect(entry.action.payload.clipId).toEqual(expect.any(String));
            expect(entry.redoAction).toEqual({
                type: 'removeClip',
                payload: { clipId: entry.action.payload.clipId, ripple: removeRipple },
            });
        } else {
            expect(entry.redoAction?.type).toBeTruthy();
        }
    }
    if (types.length > 1) {
        expect(entries[0]?.groupId).toBeTruthy();
        expect(new Set(entries.map((entry) => entry.groupId)).size).toBe(1);
    }
    return entries;
}
