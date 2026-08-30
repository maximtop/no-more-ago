/**
 * @file Shared valid-shape YouTube player-response test data.
 */

/**
 * Serializes one exact player-response assignment with the production identity shape.
 *
 * @param publication - Publication value placed in the approved field.
 * @param videoId - Primary player video identity.
 * @param externalVideoId - Microformat video identity.
 * @returns - Inert assignment text accepted by the recording parser when values are valid.
 */
export function youtubePlayerResponseAssignment(
    publication: unknown,
    videoId: unknown,
    externalVideoId: unknown = videoId,
): string {
    return `var ytInitialPlayerResponse = ${JSON.stringify({
        videoDetails: { videoId },
        microformat: {
            playerMicroformatRenderer: {
                externalVideoId,
                publishDate: publication,
            },
        },
    })};`;
}
