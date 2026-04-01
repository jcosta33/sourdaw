import { useEffect, useRef } from 'react';
import { initializeAudioEngine } from '#/modules/AudioEngine/useCases/initializeAudioEngine';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { verifyAudioBufferReferences } from '#/modules/Project/useCases/projectPersistence/helpers';
import { registerBuiltinPlugins } from '#/modules/Plugin/useCases/wamPluginHost/builtinDescriptors';
import { registerBuiltinFaustDSP } from '#/modules/Plugin/useCases/faustEngine/builtinDSP';
import { registerProModulationEffects } from '#/modules/Plugin/useCases/proModulationEffects';
import { registerProSynthInstruments } from '#/modules/Synth/useCases/proSynthInstruments';
import { initWebMidi } from '#/modules/AudioEngine/useCases/webMidiInput';
import { loadProject } from '#/modules/Project/useCases/projectPersistence/loadProject';
import { hasCrdtProject } from '#/modules/CrdtDocument/useCases/crdtProjectLifecycle';
import { projectStore } from '#/modules/Project/stores/projectStore';
import { saveProject } from '#/modules/Project/useCases/projectPersistence/saveProject';
import { ensureTrackStrips } from '#/modules/Transport/useCases/ensureTrackStrips';
import { restoreLibrary } from '#/modules/SampleLibrary/repositories/libraryPersistence';
import { preferencesStore } from '../../stores/preferencesStore';

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
                void (async () => {
                    await initializeAudioEngine();
                    // Restore audio buffers from IndexedDB now that a valid AudioContext
                    // exists. The CRDT load path runs before any user gesture so it
                    // cannot create or use an AudioContext — this is the earliest safe
                    // point to decode and cache the PCM data.
                    await audioBufferCache.restoreFromIdb(getAudioContext());
                    verifyAudioBufferReferences();
                    void initWebMidi();
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
        void restoreLibrary();
    }, []);

    useEffect(() => {
        void (async () => {
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
