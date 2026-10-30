import { createFileRoute, notFound } from '@tanstack/react-router';

import { ControlGallery } from '#/components/daw/ControlGallery';

export const Route = createFileRoute('/dev/control-gallery')({
    beforeLoad: () => {
        if (!import.meta.env.DEV) {
            notFound({ throw: true });
        }
    },
    component: ControlGallery,
});
