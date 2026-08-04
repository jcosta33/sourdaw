import { useEffect } from 'react';

import { logger } from '#/infra/logger/appLogger';
import {
    initializeAudioEngine,
    getAudioContext,
    setMasterGainValue,
    resumeEngine,
} from '#/modules/AudioEngine/useCases';
import { syncKneadToEngine } from '#/modules/Knead/useCases';
import { initWebMidi } from '#/modules/MIDI/useCases';
import { registerProModulationEffects } from '#/modules/PluginHost/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { projectStore } from '#/modules/Project/stores';
import { loadProject, saveProject } from '#/modules/Project/useCases';
import { restoreLibrary, seedFactoryLibrary } from '#/modules/SampleLibrary/useCases';
import { registerProSynthInstruments } from '#/modules/Synth/useCases';
import { ensureTrackStrips, getTransportState } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

const FIRST_LOAD_HINT_KEY = 'wd:first-load-hint-shown';
const FIRST_LOAD_HINT_DELAY_MS = 3000;

export const useAppInitialization = (): void => {
    useEffect(() => {
        // syncKneadToEngine subscribes to the knead/track stores and returns an
        // unsubscribe. It is created inside the async boot sequence, so we hold it
        // in a closure and tear it down on cleanup. `disposed` covers the race
        // where the effect unmounts before the async work registers the
        // subscription — in that case we unsubscribe as soon as it lands.
        let unsubscribeKnead: (() => void) | null = null;
        let disposed = false;

        void (async () => {
            try {
                await initializeAudioEngine();
                unsubscribeKnead = syncKneadToEngine();
                if (disposed) {
                    unsubscribeKnead();
                    unsubscribeKnead = null;
                }
                const transport = getTransportState();
                if (transport) {
                    setMasterGainValue(transport.masterGain / 100);
                }
                void initWebMidi();
                registerProModulationEffects();
                registerProSynthInstruments();

                await loadProject();
                ensureTrackStrips();
            } catch (error) {
                logger.error(new Error('App initialization failed', { cause: error }));
                notifyUser('App failed to load — please reload the page.', 'error');
            }
        })();

        return () => {
            disposed = true;
            if (unsubscribeKnead) {
                unsubscribeKnead();
                unsubscribeKnead = null;
            }
        };
    }, []);

    useEffect(() => {
        // A trusted gesture is what unlocks a suspended AudioContext. These two
        // listeners used to be registered `{ once: true }`, which made unlocking
        // single-use (audit RT-8): a first-gesture resume failure auto-removed the
        // listener that fired, so the "click anywhere to try again" prompt had
        // nothing behind it, and once both had fired an OS-level suspend or audio
        // interrupt later in the session left the app silent with no way back
        // short of a reload. They now stay armed for the effect's lifetime and
        // re-resume on every suspend/interrupt cycle. `resumeEngine()` already
        // no-ops on a running context, so a gesture during normal playback costs
        // one state check.
        //
        // `requestMicPermission()` used to fire from here on the first gesture,
        // prompting every user for the microphone whether or not they ever
        // record. It is gone: the recording path acquires its own stream
        // (acquireSharedMediaStream -> getUserMedia), so the browser asks at
        // first actual record/monitor use instead of at first click.
        let resumeInFlight = false;
        const onGesture = (): void => {
            if (resumeInFlight) {
                return;
            }
            resumeInFlight = true;
            // `finally` before `catch` so the in-flight guard clears on both
            // outcomes and the chain still terminates in a handler.
            Promise.resolve(resumeEngine())
                .finally(() => {
                    resumeInFlight = false;
                })
                .catch((error: unknown) => {
                    logger.warn(new Error('Audio engine resume failed on user gesture', { cause: error }));
                    notifyUser('Audio could not start — click anywhere to try again.', 'warning');
                });
        };
        window.addEventListener('click', onGesture);
        window.addEventListener('keydown', onGesture);
        return () => {
            window.removeEventListener('click', onGesture);
            window.removeEventListener('keydown', onGesture);
        };
    }, []);

    useEffect(() => {
        // Fire-and-forget best-effort library restore at mount; the seed step
        // already reports its own failures and there is no caller to await.
        void (async () => {
            await restoreLibrary();
            try {
                await seedFactoryLibrary(getAudioContext());
            } catch (error) {
                logger.error(new Error('Factory library seed failed', { cause: error }));
            }
        })();
    }, []);

    useEffect(() => {
        // Autosave cadence and on/off are governed by the user's preferences. The
        // "Auto Save" toggle and the interval field both exist and are validated;
        // gate the timer on them so toggling the control actually stops/starts
        // autosave and changing the interval re-arms at the new cadence. We
        // re-read on every preferences change rather than capturing once.
        let interval: ReturnType<typeof setInterval> | null = null;

        const applyAutosaveSchedule = (): void => {
            if (interval !== null) {
                clearInterval(interval);
                interval = null;
            }
            const prefs = preferencesStore.value;
            const enabled = prefs?.autoSave ?? true;
            if (!enabled) {
                return;
            }
            const intervalMs = prefs?.autoSaveIntervalMs ?? 30_000;
            interval = setInterval(() => {
                const requiresSnapshot = projectStore.value?.dirty === true;
                const transportIsPlaying = getTransportState()?.isPlaying === true;
                if (requiresSnapshot && !transportIsPlaying) {
                    // saveProject reports full-snapshot failures to the user.
                    void saveProject();
                }
            }, intervalMs);
        };

        applyAutosaveSchedule();
        const unsubscribe = preferencesStore.subscribe(applyAutosaveSchedule);
        return () => {
            if (interval !== null) {
                clearInterval(interval);
            }
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        const applyDisplayScale = (): void => {
            const scale = preferencesStore.value?.uiScale ?? 1.0;
            document.documentElement.style.zoom = String(scale);
        };

        applyDisplayScale();
        return preferencesStore.subscribe(applyDisplayScale);
    }, []);

    useEffect(() => {
        let alreadyShown: boolean;
        try {
            alreadyShown = localStorage.getItem(FIRST_LOAD_HINT_KEY) === '1';
        } catch {
            // localStorage unavailable (private mode / blocked): treat as already
            // shown so we don't pester the user when we can't persist the flag.
            alreadyShown = true;
        }
        if (alreadyShown) {
            return undefined;
        }

        const timeout = setTimeout(() => {
            notifyUser('Press ? for shortcuts · Cmd/Ctrl+K to search commands', 'info');
            try {
                localStorage.setItem(FIRST_LOAD_HINT_KEY, '1');
            } catch {
                // Best-effort persistence: if the write fails (quota / private
                // mode) the hint may reappear next load, which is acceptable.
            }
        }, FIRST_LOAD_HINT_DELAY_MS);

        return () => clearTimeout(timeout);
    }, []);
};
