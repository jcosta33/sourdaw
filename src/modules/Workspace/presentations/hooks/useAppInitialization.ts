import { useEffect, useRef } from 'react';
import { initializeAudioEngine } from '#/modules/AudioEngine/useCases/initializeAudioEngine';
import { registerBuiltinPlugins } from '#/modules/Plugin/useCases/wamPluginHost';
import { registerBuiltinFaustDSP } from '#/modules/Plugin/useCases/faustEngine';
import { registerProModulationEffects } from '#/modules/Plugin/useCases/proModulationEffects';
import { registerProSynthInstruments } from '#/modules/Synth/useCases/proSynthInstruments';
import { initWebMidi } from '#/modules/AudioEngine/useCases/webMidiInput';
import { loadProject } from '#/modules/Project/useCases/projectPersistence/loadProject';
import { saveProject } from '#/modules/Project/useCases/projectPersistence/saveProject';

/**
 * Handles one-time app startup: audio engine + plugins on first user interaction,
 * project loading, and auto-save interval.
 */
export const useAppInitialization = (): void => {
    const audioInitialized = useRef(false);

    useEffect(() => {
        const init = (): void => {
            if (!audioInitialized.current) {
                audioInitialized.current = true;
                void initializeAudioEngine();
                void initWebMidi();
                registerBuiltinPlugins();
                registerBuiltinFaustDSP();
                registerProModulationEffects();
                registerProSynthInstruments();
            }
        };
        window.addEventListener('click', init, { once: true });
        window.addEventListener('keydown', init, { once: true });
        return () => {
            window.removeEventListener('click', init);
            window.removeEventListener('keydown', init);
        };
    }, []);

    useEffect(() => {
        void loadProject();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            saveProject();
        }, 30_000);
        return () => clearInterval(interval);
    }, []);
};
