import { DomainEvent } from '#/helpers/Event/DomainEvent';

export class AudioDeviceLoadedEvent extends DomainEvent<{
    deviceId: string;
    deviceType: string;
}> {}
