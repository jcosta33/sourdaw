import { type TransportState } from '../../models/TransportState';
import { getTransportState as repoGetTransportState } from '../../repositories/transport/getTransportState';

export function getTransportStoreValue(): TransportState | null {
    return repoGetTransportState();
}
