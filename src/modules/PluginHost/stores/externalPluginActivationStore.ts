import { createStore } from '#/infra/store/createStore';

export type ExternalPluginActivationStatus = {
    status: 'loading' | 'active' | 'error';
    message?: string;
};

export type ExternalPluginActivationState = {
    byInstanceId: Record<string, ExternalPluginActivationStatus>;
};

export const defaultExternalPluginActivationState: ExternalPluginActivationState = {
    byInstanceId: {},
};

export const externalPluginActivationStore = createStore<ExternalPluginActivationState>({
    initialData: defaultExternalPluginActivationState,
});
