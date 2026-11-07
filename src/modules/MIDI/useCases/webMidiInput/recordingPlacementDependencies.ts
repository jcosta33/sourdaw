import { type midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';

export type RecordingPlacementDependencies = Pick<
    typeof midiMessageHandlerDependencies,
    'getTrackStoreState' | 'getTransportStoreValue' | 'getCompensationDelay'
>;
