import {
    createRemoteTransmissionDisclosure,
    formatRemoteTransmissionDisclosure,
    type AgentDataCategory,
} from '../models/AgentDataPolicy';

import { notifyAiChange } from './notifyAiChange';

export function discloseRemoteTransmission(categories: readonly AgentDataCategory[]) {
    notifyAiChange('Hosted AI privacy disclosure', [formatRemoteTransmissionDisclosure(categories)]);
    return createRemoteTransmissionDisclosure(categories);
}
