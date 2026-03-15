import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { AiRuntimeStatus } from "../models/IntentResult";

const logger = Container.getInstance().get(Logger);

export type AiRuntimeStoreState = {
    status: AiRuntimeStatus;
    lastError: string | null;
    browserModelReady: boolean;
};

export const aiRuntimeStore = new Store<AiRuntimeStoreState>(logger, {
    initialData: {
        status: "idle",
        lastError: null,
        browserModelReady: false,
    },
});
