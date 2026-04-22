export type SerializeMetadataInput = {
    title: string;
    artist: string;
    comment: string;
};

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

export function serializeMetadataXml(input: SerializeMetadataInput): string {
    const title = escapeXml(input.title);
    const artist = escapeXml(input.artist);
    const comment = escapeXml(input.comment);
    return `<?xml version="1.0" encoding="UTF-8"?>
<MetaData>
    <Title>${title}</Title>
    <Artist>${artist}</Artist>
    <Comment>${comment}</Comment>
</MetaData>`;
}
