import { type BatchLocalBindingProducer } from './batchLocalBindingProducers';

export function isBatchLocalDeviceParameterTarget(
    producer: BatchLocalBindingProducer,
    parameterId: unknown
): parameterId is string {
    return (
        typeof parameterId === 'string' &&
        parameterId.length > 0 &&
        producer.createdDeviceParameters?.some((parameter) => parameter.id === parameterId) === true
    );
}
