import { setSearchQuery } from '../stores/libraryStore';

export function searchSamples(query: string): void {
    setSearchQuery(query);
}
