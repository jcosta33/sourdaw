import { useEffect, useRef } from 'react';
import {
    initializeAudioEngine,
    audioBufferCache,
    getAudioContext,
    initWebMidi,
    setMasterGainValue,
} from '#/modules/AudioEngine';
import {
    verifyAudioBufferReferences,
    loadProject,
    projectStore,
    saveProject,
} from '#/modules/Project';
import { registerBuiltinPlugins, registerBuiltinFaustDSP, registerProModulationEffects } from '#/modules/Plugin';
import { registerProSynthInstruments } from '#/modules/Synth';
import { hasCrdtProject } from '#/modules/CrdtDocument';
import { ensureTrackStrips, getTransportState } from '#/modules/Transport';
import { restoreLibrary } from '#/modules/SampleLibrary';
import { preferencesStore } from '../../stores/preferencesStore';
import { trackStore } from '#/modules/Arrangement';

/**
 * Handles one-time app startup: audio engine + plugins on first user interaction,
 * project loading, and auto-save interval.
 */
export const useAppInitialization = (): void => {
    const audioInitialized = useRef(false);

    const projectLoaded = useRef(false);

    useEffect(() => {
        const init = (): void => {
            if (!audioInitialized.current) {
                audioInitialized.current = true;
                (async () => {
                    await initializeAudioEngine();
                    const transport = getTransportState();
                    if (transport) {
                        setMasterGainValue(transport.masterGain / 100);
                    }
                    // Restore audio buffers from IndexedDB now that a valid AudioContext
                    // exists. The CRDT load path runs before any user gesture so it
                    // cannot create or use an AudioContext — this is the earliest safe
                    // point to decode and cache the PCM data.
                    // Scope the load to buffer IDs referenced by the already-loaded
                    // project (loadProject runs before the first user gesture).
                    const referencedIds = (trackStore.value?.tracks ?? [])
                        .flatMap((t) => t.clips.map((c) => c.audioBufferId))
                        .filter((id): id is string => Boolean(id));
                    await audioBufferCache.restoreFromIdb(
                        getAudioContext(),
                        referencedIds.length > 0 ? referencedIds : undefined
                    );
                    verifyAudioBufferReferences();
                    initWebMidi();
                    registerBuiltinPlugins();
                    registerBuiltinFaustDSP();
                    registerProModulationEffects();
                    registerProSynthInstruments();
                    if (projectLoaded.current) {
                        ensureTrackStrips();
                    }
                })();
            }
        };
        window.addEventListener('click', init, { once: true });
        window.addEventListener('keydown', init, { once: true });
        return () => {
            window.removeEventListener('click', init);
            window.removeEventListener('keydown', init);
        };
    }, []);

    // Restore sample library roots and metadata from IndexedDB
    useEffect(() => {
        restoreLibrary();
    }, []);

    useEffect(() => {
        (async () => {
            const hasSaved = await hasCrdtProject();
            if (hasSaved) {
                // Returning user — auto-load their project (shows loading spinner).
                await loadProject();
            } else {
                // First-time user — clear the loading flag and show the LaunchScreen.
                const current = projectStore.value;
                if (current) {
                    projectStore.set({ ...current, loading: false, initialized: false });
                }
            }
            projectLoaded.current = true;
            if (audioInitialized.current) {
                ensureTrackStrips();
            }
        })();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            saveProject();
        }, 30_000);
        return () => clearInterval(interval);
    }, []);

    // Apply global UI Scaling natively
    useEffect(() => {
        const applyDisplayScale = (): void => {
            const scale = preferencesStore.value?.uiScale ?? 1.0;
            // The browser's native zoom correctly hits the layout tree without breaking flexbox/absolute boundaries
            document.documentElement.style.zoom = String(scale);
        };

        applyDisplayScale();
        return preferencesStore.subscribe(applyDisplayScale);
    }, []);
};
