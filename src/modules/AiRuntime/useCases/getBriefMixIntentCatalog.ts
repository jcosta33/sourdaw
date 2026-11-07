import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { digest } from '#/utils/canonicalDigest';

export function getBriefMixIntentCatalog() {
    const catalog = getMixRecipeCatalog();
    const descriptors = [...catalog.descriptors].sort();
    return {
        catalogId: digest({ version: catalog.version, descriptors }),
        descriptors,
        correctiveDescriptors: descriptors.filter((descriptor) => catalog.descriptorEffects[descriptor] === 'removes'),
    };
}
