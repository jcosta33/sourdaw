import { DomainEvent } from "#/helpers/Event/DomainEvent";

type TrackRemovedPayload = {
    trackId: string;
};

export class TrackRemovedEvent extends DomainEvent<TrackRemovedPayload> {}
