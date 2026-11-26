/**
 * @file Reads the live YouTube Watch player publication for the frame that asked for it.
 */

import * as v from 'valibot';

import { getYouTubeWatchVideoId } from '../../shared/adapters/youtube-contract';
import {
    YOUTUBE_PLAYER_PUBLICATION_MAX_CHARACTERS,
    readLiveYouTubePlayerPublication,
} from '../../shared/adapters/youtube-player';
import { parseHttpUrl } from '../../shared/url/http';

import { SCRIPT_EXECUTION_WORLD, type ScriptingRuntime } from './scripting';
import { settleBrowserOperation } from './settle';

/**
 * Publication value returned from the page world. Page scripts control that world, so the
 * value is parsed here before it reaches the content runtime.
 */
const livePublicationSchema = v.pipe(
    v.string(),
    v.nonEmpty(),
    v.maxLength(YOUTUBE_PLAYER_PUBLICATION_MAX_CHARACTERS),
);

/**
 * Browser-supplied identity of the frame that sent the request.
 */
export interface PublicationRequestSender {
    /**
     * Tab holding the sending frame.
     */
    readonly tab?: {
        /**
         * Tab identifier.
         */
        readonly id?: number | undefined;
    } | undefined;

    /**
     * Sending frame within the tab.
     */
    readonly frameId?: number | undefined;

    /**
     * Current URL of the sending frame.
     */
    readonly url?: string | undefined;
}

/**
 * Runs the live-player reader in the page world of exactly the sending frame.
 *
 * @param scripting - Scripting API boundary.
 * @param sender - Browser-supplied identity of the requesting frame.
 * @param href - Watch URL the requesting runtime processes.
 *
 * @returns - Parsed publication value, or null when the request, the frame, or the player
 * does not qualify.
 */
export async function readYouTubePlayerPublication(
    scripting: ScriptingRuntime,
    sender: PublicationRequestSender,
    href: string,
): Promise<string | null> {
    const url = parseHttpUrl(href);
    const videoId = url ? getYouTubeWatchVideoId(url) : null;
    const tabId = sender.tab?.id;
    const { frameId } = sender;
    if (
        !url
        || videoId === null
        || parseHttpUrl(sender.url)?.origin !== url.origin
        || tabId === undefined
        || frameId === undefined
    ) {
        return null;
    }
    const injected = await settleBrowserOperation(() => scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: SCRIPT_EXECUTION_WORLD.MAIN,
        func: readLiveYouTubePlayerPublication,
        args: [url.href, videoId],
    }));
    if (!injected.ok) {
        return null;
    }
    const parsed = v.safeParse(livePublicationSchema, injected.value[0]?.result);
    return parsed.success ? parsed.output : null;
}
