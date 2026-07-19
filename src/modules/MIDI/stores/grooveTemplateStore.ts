import { createStore } from '#/infra/store/createStore';

import {
    defaultGrooveTemplateState,
    sanitizeGrooveTemplateState,
    type GrooveTemplateState,
} from '../models/GrooveTemplateState';

import { createGrooveTemplateAutomergeStorage } from './grooveTemplateAutomergeStorage';

export {
    GROOVE_CONSUMER_TYPES,
    defaultGrooveTemplateState,
    isGrooveTemplateState,
    sanitizeGrooveTemplateState,
    type GrooveConsumerType,
    type GrooveTemplateAssignment,
    type GrooveTemplateState,
} from '../models/GrooveTemplateState';

export const grooveTemplateStore = createStore<GrooveTemplateState>({
    storage: createGrooveTemplateAutomergeStorage(),
    initialData: defaultGrooveTemplateState,
    sanitize: sanitizeGrooveTemplateState,
});
