import { type Page } from '@playwright/test';

import { type LoopbackOpenAiProvider } from './loopbackOpenAiProvider';

/**
 * The two product use cases this admission calls. `import()` of a dev-server
 * URL has no type of its own, so the calls are stated against the shapes the
 * modules export rather than made through an untyped value.
 */
type ConfigureCloudProviderModule = {
    configureCloudProvider: (configuration: {
        provider: 'openai-compatible';
        model: string;
        baseUrl: string;
        authentication: 'none';
        apiKey: string;
    }) => Promise<void>;
};

type SetAiBackendPreferenceModule = {
    setAiBackendPreference: (preference: 'cloud') => void;
};

/**
 * Points the running app at the loopback endpoint through its own product use
 * cases, so admission is decided by `configureCloudProvider` and the backend
 * chain rather than by anything the test fakes.
 *
 * The dynamic `/src/...` imports only resolve under the dev server the browser
 * specs run against; the packaged app admits the same endpoint through the
 * Preferences UI instead (`scripts/proveDesktopAgentWorkspace.ts`).
 */
export async function admitLoopbackProvider(page: Page, provider: LoopbackOpenAiProvider): Promise<void> {
    await page.evaluate(
        async ({ baseUrl, model }) => {
            const { configureCloudProvider } =
                (await import('/src/modules/AiRuntime/useCases/cloudApiManagement/configureCloudProvider.ts')) as ConfigureCloudProviderModule;
            const { setAiBackendPreference } =
                (await import('/src/modules/AiRuntime/useCases/llmOrchestration/backendResolution/setAiBackendPreference.ts')) as SetAiBackendPreferenceModule;
            await configureCloudProvider({
                provider: 'openai-compatible',
                model,
                baseUrl,
                authentication: 'none',
                apiKey: '',
            });
            setAiBackendPreference('cloud');
        },
        { baseUrl: provider.baseUrl, model: provider.model }
    );
}
