import '#/styles/main.css';
import { createRoot } from 'react-dom/client';

import { audioRuntimeConfiguration } from '#/infra/audio/audioRuntimeConfiguration';
import { resolveAudioLatencyProfile } from '#/infra/audio/resolveAudioLatencyProfile';
import { preferencesStore } from '#/modules/Preferences/stores';

import { reportStartupFailure } from './reportStartupFailure';

async function startApplication(): Promise<void> {
    const requestedProfile = new URLSearchParams(globalThis.location.search).get('audioLatencyProfile');
    const latencyProfile = resolveAudioLatencyProfile({
        requestedProfile,
        persistedProfile: preferencesStore.value?.audioLatencyProfile,
    });
    audioRuntimeConfiguration.configureLatencyProfile(latencyProfile);

    await import('./bootstrap');
    const { App } = await import('./App');
    createRoot(document.getElementById('root')!).render(<App />);
}

startApplication().catch(reportStartupFailure);
