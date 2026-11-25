import { getChangesMetaSince, getHeads, type Heads } from '@automerge/automerge';

import { getWarpState, trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction, executeAppActionBatch } from '#/modules/Command/useCases';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { preferencesStore, type Preferences } from '#/modules/Preferences/stores';
import { updatePreferences } from '#/modules/Preferences/useCases';
import { type buildProjectData } from '#/modules/Project/useCases';

const TRACKS_PER_KIND = 16;
const CLIPS_PER_TRACK = 8;
const NOTES_PER_CLIP = 64;
const EDITS = 2048;
const COMPANION_CLIPS = 8;

type Action = Parameters<typeof executeAppAction>[0];
type Root = {
    tracks?: Pick<NonNullable<typeof trackStore.value>, 'tracks'>;
    midi?: Pick<NonNullable<typeof midiStore.value>, 'notesByClipId'>;
    warpStates?: { states: Record<string, ReturnType<typeof getWarpState>> };
};

function readRoot() {
    const root = getCrdtDoc<Root>('root');
    if (!root) {
        throw new Error('Dense Elastic fixture requires an open project document');
    }
    return root;
}

async function commitBatch(actions: Action[]): Promise<void> {
    const result = await executeAppActionBatch(actions);
    if (result.status !== 'committed' || result.actions.length !== actions.length) {
        throw new Error(`Dense Elastic fixture batch did not commit: ${result.status}`);
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export async function seedDenseElasticProject(targetClipId: string) {
    const sourceTrack = trackStore.value?.tracks.find((track) => track.clips.some((clip) => clip.id === targetClipId));
    const source = sourceTrack?.clips.find((clip) => clip.id === targetClipId);
    if (!sourceTrack || source?.type !== 'audio' || !source.audioBufferId) {
        throw new Error('Dense Elastic fixture requires the imported stereo source');
    }

    // Make individual, retained edits before adding clips and notes, while projections are cheap.
    const beforeEdits = getHeads(readRoot());
    for (let index = 0; index < EDITS; index++) {
        await executeAppAction({
            type: 'renameTrack',
            payload: { trackId: sourceTrack.id, name: `History edit ${index}` },
        });
        if ((index + 1) % 32 === 0) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
    }
    const edited = readRoot();
    const historyHeads = getHeads(edited);
    const historyChanges = getChangesMetaSince(edited, beforeEdits).length;

    const trackIds = [sourceTrack.id];
    for (let index = 1; index < TRACKS_PER_KIND * 2; index++) {
        const id = `dense-track-${index}`;
        const kind = index < TRACKS_PER_KIND ? 'audio' : 'midi';
        await executeAppAction({
            type: 'addTrack',
            payload: { id, kind, name: `Dense ${kind} ${index}`, select: false },
        });
        trackIds.push(id);
    }

    const companionIds: string[] = [];
    for (const [trackIndex, trackId] of trackIds.entries()) {
        const audio = trackIndex < TRACKS_PER_KIND;
        const length = audio ? source.endBeat - source.startBeat : NOTES_PER_CLIP / 2;
        const clips: Action[] = [];
        const notes: Action[] = [];
        for (let index = trackIndex === 0 ? 1 : 0; index < CLIPS_PER_TRACK; index++) {
            const clipId = `dense-clip-${trackIndex}-${index}`;
            clips.push({
                type: 'addClip',
                payload: {
                    id: clipId,
                    trackId,
                    name: `Dense phrase ${index + 1}`,
                    type: audio ? 'audio' : 'midi',
                    startBeat: index * length,
                    endBeat: (index + 1) * length,
                    ...(audio ? { audioBufferId: source.audioBufferId, assetHash: source.assetHash } : {}),
                },
            });
            if (!audio) {
                notes.push({
                    type: 'addNotes',
                    payload: {
                        clipId,
                        notes: Array.from({ length: NOTES_PER_CLIP }, (_, note) => ({
                            pitch: 48 + ((note + trackIndex) % 24),
                            startBeat: note / 2,
                            duration: 0.375,
                            velocity: 64 + (note % 5) * 12,
                        })),
                    },
                });
            }
        }
        await commitBatch(clips);
        if (notes.length > 0) {
            await commitBatch(notes);
        }
        if (trackIndex > 0 && trackIndex <= COMPANION_CLIPS) {
            companionIds.push(`dense-clip-${trackIndex}-0`);
        }
    }
    for (const clipId of companionIds) {
        await executeAppAction({ type: 'detectTransients', payload: { clipId, sensitivity: 0.5 } });
    }
    return { historyHeads, historyChanges, companionIds, targetTrackId: sourceTrack.id };
}

function retainsHistory(root: ReturnType<typeof readRoot>, heads: Heads): boolean {
    const applied = new Set(getChangesMetaSince(root, []).map(({ hash }) => hash));
    // A shared backend can know changes beyond this root's current causal frontier.
    for (const { hash } of getChangesMetaSince(root, getHeads(root))) {
        applied.delete(hash);
    }
    return heads.every((hash) => applied.has(hash));
}

export function readDenseElasticProject(companionIds: string[], historyHeads?: Heads) {
    const root = readRoot();
    const tracks = root.tracks?.tracks ?? [];
    const notes = root.midi?.notesByClipId ?? {};
    const lastMidiTrack = tracks.find((track) => track.id === 'dense-track-31');
    return {
        historyRetained: historyHeads === undefined ? undefined : retainsHistory(root, historyHeads),
        preserved: {
            audioTracks: tracks.filter((track) => track.kind === 'audio').length,
            midiTracks: tracks.filter((track) => track.kind === 'midi').length,
            clips: tracks.reduce((count, track) => count + track.clips.length, 0),
            notes: Object.values(notes).reduce((count, clipNotes) => count + clipNotes.length, 0),
            lastMidiTrack: lastMidiTrack?.name,
            // The named format materializes both neutral expression defaults on reopen.
            lastMidiClipNotes: notes['dense-clip-31-7']?.map(({ pressure = 0, pitchBend = 0, ...note }) => ({
                ...note,
                pressure,
                pitchBend,
            })),
            companionMarkers: companionIds.map((clipId) => root.warpStates?.states[clipId]?.markers ?? []),
        },
    };
}

function observeNamedAutosave(status: HTMLElement, preference: Pick<Preferences, 'autoSave' | 'autoSaveIntervalMs'>) {
    const nativeInterval = window.setInterval;
    const firstFire = Promise.withResolvers<{ fired: number; pending: boolean }>();
    let scheduled = 0;
    // Restoring the preference synchronously schedules the application's actual interval.
    window.setInterval = (callback, delay, ...args) => {
        if (typeof callback !== 'function' || delay !== preference.autoSaveIntervalMs) {
            return nativeInterval(callback, delay, ...args);
        }
        scheduled = performance.now();
        return nativeInterval(
            function (this: unknown, ...received: unknown[]) {
                const mark = performance.mark('dense-elastic-named-autosave');
                firstFire.resolve({ fired: mark.startTime, pending: status.textContent === 'Detecting…' });
                Reflect.apply(callback, this, received);
            },
            delay,
            ...args
        );
    };
    try {
        updatePreferences({ patch: preference });
    } finally {
        window.setInterval = nativeInterval;
    }
    if (scheduled === 0 || preferencesStore.value?.autoSave !== true) {
        throw new Error('Restoring default autosave did not schedule the named project interval');
    }
    return { scheduled, firstFire: firstFire.promise };
}

function observeDetectWorker(signal: AbortSignal) {
    const reply = Promise.withResolvers<{ hits: number; received: number }>();
    const post = Worker.prototype.postMessage;
    const observedPost = new Proxy(post, {
        apply(target, worker: Worker, args: unknown[]): unknown {
            const request = args[0];
            if (
                typeof request === 'object' &&
                request !== null &&
                'channels' in request &&
                'sampleRate' in request &&
                'sensitivity' in request
            ) {
                Worker.prototype.postMessage = post;
                worker.addEventListener(
                    'message',
                    (event: MessageEvent<unknown>) => {
                        const result = event.data;
                        if (
                            event.isTrusted &&
                            typeof result === 'object' &&
                            result !== null &&
                            'status' in result &&
                            result.status === 'complete' &&
                            'hits' in result &&
                            Array.isArray(result.hits)
                        ) {
                            reply.resolve({ hits: result.hits.length, received: performance.now() });
                        }
                    },
                    { capture: true, once: true, signal }
                );
            }
            return Reflect.apply(target, worker, args);
        },
    });
    Worker.prototype.postMessage = observedPost;
    signal.addEventListener(
        'abort',
        () => {
            if (Worker.prototype.postMessage === observedPost) {
                Worker.prototype.postMessage = post;
            }
        },
        { once: true }
    );
    return reply.promise;
}

export async function detectAcrossNamedAutosave(
    button: HTMLButtonElement,
    status: HTMLElement,
    preference: Pick<Preferences, 'autoSave' | 'autoSaveIntervalMs'>
) {
    const { scheduled, firstFire } = observeNamedAutosave(status, preference);
    const stopObservation = new AbortController();
    const click = Promise.withResolvers<{ started: number; worker: { hits: number; received: number } }>();
    // Align in the browser so a controller round trip cannot consume the overlap window.
    const clickAt = scheduled + preference.autoSaveIntervalMs - 175;
    const clickTimer = window.setTimeout(() => {
        const reply = observeDetectWorker(stopObservation.signal);
        const started = performance.now();
        button.click();
        click.resolve(reply.then((worker) => ({ started, worker })));
    }, clickAt - performance.now());
    const deadline = Promise.withResolvers<never>();
    const expiry = window.setTimeout(() => {
        const fired = performance.getEntriesByName('dense-elastic-named-autosave').length > 0;
        deadline.reject(
            new Error(fired ? 'Detect did not return a real Worker result' : 'The named autosave did not fire')
        );
    }, preference.autoSaveIntervalMs + 10_000);
    try {
        const [autosave, detection] = await Promise.race([Promise.all([firstFire, click.promise]), deadline.promise]);
        return { autosave, ...detection };
    } finally {
        stopObservation.abort();
        window.clearTimeout(clickTimer);
        window.clearTimeout(expiry);
    }
}

type NamedSnapshot = NonNullable<Awaited<ReturnType<typeof buildProjectData>>>['data'];

export async function readNamedElasticSave(key: string, clipId: string, trackId: string) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sourdaw-projects');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        const raw = await new Promise<unknown>((resolve, reject) => {
            const tx = database.transaction('projects', 'readonly');
            const request = tx.objectStore('projects').get(key);
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () => reject(tx.error);
        });
        if (typeof raw !== 'string') {
            return null;
        }
        const snapshot = JSON.parse(raw) as NamedSnapshot;
        return {
            markers: snapshot.warpStates?.find((state) => state.clipId === clipId)?.markers,
            trackName: snapshot.arrangement.tracks.find((track) => track.id === trackId)?.name,
        };
    } finally {
        database.close();
    }
}
