import { useEffect } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    initializeAudioEngine,
    getAudioContext,
    initWebMidi,
    setMasterGainValue,
    resumeEngine,
    requestMicPermission,
} from '#/modules/AudioEngine/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { hasCrdtProject } from '#/modules/CrdtDocument/useCases';
import { syncKneadToEngine } from '#/modules/Knead/useCases';
import { registerProModulationEffects } from '#/modules/Plugin/useCases';
import { projectStore } from '#/modules/Project/stores';
import { verifyAudioBufferReferences, loadProject, saveProject } from '#/modules/Project/useCases';
import { restoreLibrary } from '#/modules/SampleLibrary/useCases';
import { registerProSynthInstruments } from '#/modules/Synth/useCases';
import { ensureTrackStrips, getTransportState } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { preferencesStore } from '../../stores/preferencesStore';

export const useAppInitialization = (): void => {
    useEffect(() => {
        (async () => {
            try {
                await initializeAudioEngine();
                syncKneadToEngine();
                const transport = getTransportState();
                if (transport) {
                    setMasterGainValue(transport.masterGain / 100);
                }
                const referencedIds = (trackStore.value?.tracks ?? [])
                    .flatMap((t) => t.clips.map((c) => c.audioBufferId))
                    .filter((id): id is string => Boolean(id));
                await audioBufferCache.restoreFromIdb(
                    getAudioContext(),
                    referencedIds.length > 0 ? referencedIds : undefined
                );
                verifyAudioBufferReferences();
                initWebMidi();
                registerProModulationEffects();
                registerProSynthInstruments();

                const hasSaved = await hasCrdtProject();
                if (hasSaved) {
                    await loadProject();
                } else {
                    const current = projectStore.value;
                    if (current) {
                        projectStore.set({ ...current, loading: false, initialized: false });
                    }
                }
                ensureTrackStrips();
            } catch (error) {
                logger.error(new Error('App initialization failed', { cause: error }));
                notifyUser('App failed to load — please reload the page.', 'error');
            }
        })();
    }, []);

    useEffect(() => {
        const onGesture = (): void => {
            void resumeEngine();
            requestMicPermission();
        };
        window.addEventListener('click', onGesture, { once: true });
        window.addEventListener('keydown', onGesture, { once: true });
        return () => {
            window.removeEventListener('click', onGesture);
            window.removeEventListener('keydown', onGesture);
        };
    }, []);

    useEffect(() => {
        restoreLibrary();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            saveProject();
        }, 30_000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const applyDisplayScale = (): void => {
            const scale = preferencesStore.value?.uiScale ?? 1.0;
            document.documentElement.style.zoom = String(scale);
        };

        applyDisplayScale();
        return preferencesStore.subscribe(applyDisplayScale);
    }, []);
};
