import { Container } from '../Container';
import { resetContainerState } from '../internal/containerState';

export const createTestContainer = () => {
    resetContainerState();
    return Container;
};
