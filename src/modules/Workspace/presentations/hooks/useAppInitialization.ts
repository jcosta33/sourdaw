import { useEffect } from 'react';

import { trackStore } from '#/modules/Arrangement/stores';
import {
    initializeAudioEngine,
    getAudioContext,
    initWebMidi,
    setMasterGainValue,
    resumeEngine,
    requestMicPermission,
} from '#/modules/AudioEngine';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { hasCrdtProject } from '#/modules/CrdtDocument';
import { registerProModulationEffects } from '#/modules/Plugin';
import { verifyAudioBufferReferences, loadProject, projectStore, saveProject } from '#/modules/Project';
import { restoreLibrary } from '#/modules/SampleLibrary';
import { registerProSynthInstruments } from '#/modules/Synth';
import { ensureTrackStrips, getTransportState } from '#/modules/Transport';

import { preferencesStore } from '../../stores/preferencesStore';

/**
 * Handles one-time app startup: audio engine worklet loading on mount,
 * plugin registration, project loading (gated on engine readiness so the
 * UI cannot create tracks before worklets are registered), AudioContext
 * resume on first user gesture, and auto-save interval.
 */
export const useAppInitialization = (): void => {
    // Kick off non-gesture startup on mount: worklet loading, plugin
    // registration, audio buffer restore, MIDI init. All of this must
    // complete before the project is marked initialized, because that flag
    // drives LaunchScreen exit and the track-creation UI becoming clickable.
    useEffect(() => {
        (async () => {
            await initializeAudioEngine();
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
        })();
    }, []);

    // AudioContext.resume() and mic permission both require a real user
    // gesture — resume unsuspends the context, and requesting mic permission
    // at the first interaction gives the prompt a clear cause.
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

    // Restore sample library roots and metadata from IndexedDB
    useEffect(() => {
        restoreLibrary();
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
