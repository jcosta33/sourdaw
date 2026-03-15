import { DomainEvent } from "#/helpers/Event/DomainEvent";

type TrackAddedPayload = {
    trackId: string;
    name: string;
    kind: string;
};

export class TrackAddedEvent extends DomainEvent<TrackAddedPayload> {}
