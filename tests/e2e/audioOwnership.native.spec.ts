import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const MODULE_DOCUMENT = '/src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts';
const PROJECT_AUDIO_STORAGE_LOCK_NAME = 'sourdaw:project-audio-storage';
const PROJECT_DATABASE_NAME = 'sourdaw-projects';
const AUDIO_DATABASE_NAME = 'sourdaw-audio';
const CRDT_DATABASE_NAME = 'sourdaw-crdt-docs';
const CREATED_AT = 1_700_000_000_000;
const EXPECTED_PCM = [0, 1, -1, 0];

async function openRealm(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await page.goto(MODULE_DOCUMENT);
    return page;
}

async function deleteDatabase(page: Page, name: string): Promise<void> {
    await page.evaluate(async (databaseName) => {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(databaseName);
            request.addEventListener('success', () => resolve(), { once: true });
            request.addEventListener(
                'error',
                () => reject(request.error ?? new Error(`Deleting ${databaseName} failed`)),
                { once: true }
            );
            request.addEventListener('blocked', () => reject(new Error(`Deleting ${databaseName} was blocked`)), {
                once: true,
            });
        });
    }, name);
}

async function clearStorage(page: Page): Promise<void> {
    await page.evaluate(() => localStorage.clear());
    for (const name of [PROJECT_DATABASE_NAME, AUDIO_DATABASE_NAME, CRDT_DATABASE_NAME]) {
        await deleteDatabase(page, name);
    }
}

async function initializeProjectWithAudio(page: Page): Promise<string> {
    return page.evaluate(
        async ({ createdAt, samples }) => {
            const [
                audio,
                arrangement,
                project,
                projectStores,
                arrangementStores,
                crdt,
                helpers,
                metadata,
                collaboration,
                command,
            ] = await Promise.all([
                import('/src/modules/AudioEngine/useCases/index.ts'),
                import('/src/modules/Arrangement/useCases/index.ts'),
                import('/src/modules/Project/useCases/index.ts'),
                import('/src/modules/Project/stores/index.ts'),
                import('/src/modules/Arrangement/stores/index.ts'),
                import('/src/modules/CrdtDocument/useCases/index.ts'),
                import('/src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts'),
                import('/src/modules/Project/useCases/createFreshProjectMetadata.ts'),
                import('/src/modules/Collaboration/useCases/index.ts'),
                import('/src/modules/Command/stores/index.ts'),
            ]);

            await audio.restoreCachedAudioBuffersFromIdb({ audioContext: audio.audioEngine.context });
            arrangement.setArrangementEventBus({ emit: () => Promise.resolve() });
            command.clearHandlerRegistry();
            command.registerHandlerMap(arrangement.getArrangementHandlers());
            crdt.registerCrdtStorageRuntime();
            collaboration.configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
            project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
            crdt.resetCrdtProjectAuthority('Native audio ownership');
            helpers.resetModuleStoresToDefault();
            projectStores.projectStore.set({
                ...metadata.createFreshProjectMetadata({
                    name: 'Native audio ownership',
                    loading: false,
                    initialized: true,
                }),
                createdAt,
                updatedAt: createdAt,
                dirty: true,
            });

            const bytesPerSample = Int16Array.BYTES_PER_ELEMENT;
            const bytes = new ArrayBuffer(44 + samples.length * bytesPerSample);
            const view = new DataView(bytes);
            const writeAscii = (offset: number, value: string): void => {
                for (let index = 0; index < value.length; index++) {
                    view.setUint8(offset + index, value.charCodeAt(index));
                }
            };
            writeAscii(0, 'RIFF');
            view.setUint32(4, bytes.byteLength - 8, true);
            writeAscii(8, 'WAVE');
            writeAscii(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, 48_000, true);
            view.setUint32(28, 48_000 * bytesPerSample, true);
            view.setUint16(32, bytesPerSample, true);
            view.setUint16(34, 16, true);
            writeAscii(36, 'data');
            view.setUint32(40, samples.length * bytesPerSample, true);
            for (const [index, sample] of samples.entries()) {
                view.setInt16(44 + index * bytesPerSample, Math.round(sample * 0x7fff), true);
            }
            const file = new File([bytes], 'native-ownership.wav', { type: 'audio/wav' });
            const outcome = await arrangement.importAudioFile(file, { shouldContinue: () => true });
            if (outcome !== 'completed') {
                throw new Error(`Audio import ended with ${outcome}`);
            }
            const bufferId = arrangementStores.trackStore.value?.tracks.flatMap((track) => track.clips)[0]
                ?.audioBufferId;
            if (!bufferId) {
                throw new Error('The production import did not publish an audio clip');
            }
            Reflect.set(globalThis, '__sourdawNativeAudioBufferId', bufferId);
            return bufferId;
        },
        { createdAt: CREATED_AT, samples: EXPECTED_PCM }
    );
}

async function saveProject(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const { saveProject } = await import('/src/modules/Project/useCases/index.ts');
        return saveProject();
    });
}

async function collectWithRealProvider(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const [audio, project] = await Promise.all([
            import('/src/modules/AudioEngine/useCases/index.ts'),
            import('/src/modules/Project/useCases/index.ts'),
        ]);
        audio.configureDurableAudioBufferOwnership(project.collectDurableOwnedAudioBufferIds);
        return audio.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 0 });
    });
}

async function beginCollectionWithCapturedRealCensus(page: Page): Promise<readonly string[]> {
    return page.evaluate(async () => {
        const [audio, project] = await Promise.all([
            import('/src/modules/AudioEngine/useCases/index.ts'),
            import('/src/modules/Project/useCases/index.ts'),
        ]);
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });
        let observed!: (ids: readonly string[]) => void;
        const censusObserved = new Promise<readonly string[]>((resolve) => {
            observed = resolve;
        });
        audio.configureDurableAudioBufferOwnership(async () => {
            const realOwnedIds = await project.collectDurableOwnedAudioBufferIds();
            observed(realOwnedIds);
            await released;
            return realOwnedIds;
        });
        Reflect.set(globalThis, '__sourdawReleaseNativeCensus', release);
        Reflect.set(
            globalThis,
            '__sourdawPendingNativeCollection',
            audio.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 0 })
        );
        return censusObserved;
    });
}

async function releaseCollection(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const release = Reflect.get(globalThis, '__sourdawReleaseNativeCensus') as (() => void) | undefined;
        const pending = Reflect.get(globalThis, '__sourdawPendingNativeCollection') as Promise<number> | undefined;
        if (!release || !pending) {
            throw new Error('No captured native ownership census is pending');
        }
        release();
        return pending;
    });
}

async function beginSaveWaitingForLock(page: Page): Promise<void> {
    await page.evaluate(async (lockName) => {
        const { saveProject } = await import('/src/modules/Project/useCases/index.ts');
        let settled = false;
        const pending = saveProject().finally(() => {
            settled = true;
        });
        Reflect.set(globalThis, '__sourdawPendingNativeSave', pending);
        for (;;) {
            const state = await navigator.locks.query();
            if (state.pending?.some((lock) => lock.name === lockName)) {
                return;
            }
            if (settled) {
                throw new Error('Production save settled before waiting for project audio storage admission');
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }, PROJECT_AUDIO_STORAGE_LOCK_NAME);
}

async function finishPendingSave(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const pending = Reflect.get(globalThis, '__sourdawPendingNativeSave') as Promise<boolean> | undefined;
        if (!pending) {
            throw new Error('No native save is pending');
        }
        return pending;
    });
}

async function readDurableProjectAudio(page: Page, bufferId: string): Promise<{ json: string | null; pcm: number[] }> {
    return page.evaluate(
        async ({ createdAt, id, audioDatabaseName }) => {
            const project = await import('/src/modules/Project/useCases/index.ts');
            const { readNamedProjectJson } =
                await import('/src/modules/Project/repositories/project/readNamedProjectJson.ts');
            const json = await readNamedProjectJson(project.getProjectSnapshotKey(createdAt));
            const pcm = await new Promise<number[]>((resolve, reject) => {
                const open = indexedDB.open(audioDatabaseName);
                open.addEventListener('error', () => reject(open.error ?? new Error('Opening audio storage failed')), {
                    once: true,
                });
                open.addEventListener(
                    'success',
                    () => {
                        const database = open.result;
                        const transaction = database.transaction('buffers', 'readonly');
                        const request = transaction.objectStore('buffers').get(id);
                        let samples: number[] = [];
                        request.addEventListener('success', () => {
                            const value: unknown = request.result;
                            const channelData =
                                value !== null && typeof value === 'object'
                                    ? Reflect.get(value, 'channelData')
                                    : undefined;
                            const channel = Array.isArray(channelData) ? channelData[0] : undefined;
                            if (Object.prototype.toString.call(channel) === '[object Float32Array]') {
                                const length =
                                    channel !== null && typeof channel === 'object'
                                        ? Reflect.get(channel, 'length')
                                        : undefined;
                                if (typeof length === 'number') {
                                    samples = Array.from({ length }, (_, index) => {
                                        const sample = Reflect.get(channel, String(index));
                                        return typeof sample === 'number' ? sample : Number.NaN;
                                    });
                                }
                            }
                        });
                        transaction.addEventListener(
                            'complete',
                            () => {
                                database.close();
                                resolve(samples);
                            },
                            { once: true }
                        );
                        transaction.addEventListener(
                            'abort',
                            () => reject(transaction.error ?? new Error('Reading audio storage was aborted')),
                            { once: true }
                        );
                    },
                    { once: true }
                );
            });
            return { json, pcm };
        },
        { createdAt: CREATED_AT, id: bufferId, audioDatabaseName: AUDIO_DATABASE_NAME }
    );
}

async function holdNativeLock(page: Page): Promise<void> {
    await page.evaluate(async (lockName) => {
        let acquired!: () => void;
        const admission = new Promise<void>((resolve) => {
            acquired = resolve;
        });
        void navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
            acquired();
            await new Promise(() => undefined);
        });
        await admission;
    }, PROJECT_AUDIO_STORAGE_LOCK_NAME);
}

test.describe('project audio ownership with native IndexedDB and Web Locks', () => {
    test('save-first collection preserves the real named snapshot and PCM', async ({ context }) => {
        const saver = await openRealm(context);
        const collector = await openRealm(context);
        await clearStorage(saver);
        const bufferId = await initializeProjectWithAudio(saver);

        await expect(saveProject(saver)).resolves.toBe(true);
        await expect(collectWithRealProvider(collector)).resolves.toBe(0);

        const durable = await readDurableProjectAudio(collector, bufferId);
        expect(durable.json).toContain(bufferId);
        expect(durable.pcm).toEqual(EXPECTED_PCM);
    });

    test('collection-first admission lets the queued production save restore and publish exact PCM', async ({
        context,
    }) => {
        const saver = await openRealm(context);
        const collector = await openRealm(context);
        await clearStorage(saver);
        const bufferId = await initializeProjectWithAudio(saver);

        await expect(beginCollectionWithCapturedRealCensus(collector)).resolves.toEqual([]);
        await beginSaveWaitingForLock(saver);
        await releaseCollection(collector);
        await expect(finishPendingSave(saver)).resolves.toBe(true);

        const durable = await readDurableProjectAudio(collector, bufferId);
        expect(durable.json).toContain(bufferId);
        expect(durable.pcm).toEqual(EXPECTED_PCM);
    });

    test('closing a native lock-holder realm releases queued admission', async ({ context }) => {
        const waiter = await openRealm(context);
        const holder = await openRealm(context);
        await holdNativeLock(holder);
        const admitted = waiter.evaluate(async () => {
            const { withProjectAudioStorageLock } = await import('/src/infra/storage/withProjectAudioStorageLock.ts');
            return withProjectAudioStorageLock(async () => 'admitted');
        });

        await expect
            .poll(async () => {
                const state = await waiter.evaluate(async () => navigator.locks.query());
                return state.pending?.some((lock) => lock.name === PROJECT_AUDIO_STORAGE_LOCK_NAME);
            })
            .toBe(true);
        await holder.close();

        await expect(admitted).resolves.toBe('admitted');
    });
});
