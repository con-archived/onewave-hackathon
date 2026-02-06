import { z } from "zod";

// Zod schemas for Genius API responses
const GeniusArtistSchema = z.object({
    name: z.string(),
});

const GeniusSongResultSchema = z.object({
    id: z.number(),
    title: z.string(),
    primary_artist: GeniusArtistSchema,
    song_art_image_url: z.string(),
    url: z.string(),
});

const GeniusHitSchema = z.object({
    result: GeniusSongResultSchema,
});

const GeniusMetaSchema = z.object({
    status: z.number(),
});

const GeniusSearchResponseSchema = z.object({
    meta: GeniusMetaSchema,
    response: z.object({
        hits: z.array(GeniusHitSchema),
    }),
});

const GeniusSongResponseSchema = z.object({
    meta: GeniusMetaSchema,
    response: z.object({
        song: z.object({
            id: z.number(),
            title: z.string(),
            url: z.string(),
            primary_artist: GeniusArtistSchema,
        }),
    }),
});

// Cloudflare Workers bindings type
export interface Env {
    SECRET_GENIUS_API_KEY: string;
}

// Result types for exported functions
export interface SongSearchResult {
    id: number;
    title: string;
    artist: string;
    albumArt: string;
    url: string;
}

export interface SongWithLyrics {
    id: number;
    title: string;
    artist: string;
    lyrics: string;
}

/**
 * Get the Genius API key from environment
 * @param env - Cloudflare Workers env object (optional, for non-Workers context)
 */
function getApiKey(env?: Env): string {
    if (env?.SECRET_GENIUS_API_KEY) {
        return env.SECRET_GENIUS_API_KEY;
    }
    throw new Error("SECRET_GENIUS_API_KEY environment variable is not set");
}

/**
 * Search for songs by name and/or artist on Genius
 * @param query - Search query (e.g., "Taylor Swift Shake It Off")
 * @param env - Cloudflare Workers env object (optional, for non-Workers context)
 * @returns Array of song results with id, title, artist, albumArt, and url
 */
export async function searchSongs(query: string, env?: Env): Promise<SongSearchResult[]> {
    const apiKey = getApiKey(env);
    const url = new URL("https://api.genius.com/search");
    url.searchParams.set("q", query);

    const response = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Genius API error: ${response.status} ${response.statusText}`);
    }

    const rawData = await response.json();

    // Parse and validate with Zod
    const data = GeniusSearchResponseSchema.parse(rawData);

    if (data.meta.status !== 200) {
        throw new Error(`Genius API returned status: ${data.meta.status}`);
    }

    return data.response.hits.map((hit) => ({
        id: hit.result.id,
        title: hit.result.title,
        artist: hit.result.primary_artist.name,
        albumArt: hit.result.song_art_image_url,
        url: hit.result.url,
    }));
}

/**
 * Extract lyrics from Genius page HTML
 * Genius stores lyrics in div elements with data-lyrics-container="true"
 */
function extractLyricsFromHtml(html: string): string {
    // Pass-through (DOMPurify doesn't work in Cloudflare Workers)
    const sanitizedHtml = html;

    // Match all data-lyrics-container divs
    const lyricsContainerRegex = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g;
    const matches = sanitizedHtml.matchAll(lyricsContainerRegex);

    const lyricsParts: string[] = [];
    for (const match of matches) {
        let content = match[1] ?? "";
        // Convert br tags to newlines, then remove remaining HTML tags
        content = content.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "");
        // Decode HTML entities (numeric first, then named to handle double-encoding correctly)
        content = content
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
            .replace(/&#(\d+);/gi, (_, code) => String.fromCodePoint(Number(code)))
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&(apos|#x27|#39);/gi, "'");
        content = content.trim();
        if (content) {
            lyricsParts.push(content);
        }
    }

    if (lyricsParts.length === 0) {
        throw new Error("Could not extract lyrics from page");
    }

    return lyricsParts.join("\n\n");
}

/**
 * Get song lyrics by Genius song ID
 * @param songId - Genius song ID
 * @param env - Cloudflare Workers env object (optional, for non-Workers context)
 * @returns Song info with lyrics (id, title, artist, lyrics)
 */
export async function getLyricsById(songId: number, env?: Env): Promise<SongWithLyrics> {
    const apiKey = getApiKey(env);

    // First, get the song details including the URL
    const songUrl = `https://api.genius.com/songs/${encodeURIComponent(String(songId))}`;
    const songResponse = await fetch(songUrl, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (!songResponse.ok) {
        throw new Error(`Genius API error: ${songResponse.status} ${songResponse.statusText}`);
    }

    const rawSongData = await songResponse.json();

    // Parse and validate with Zod
    const songData = GeniusSongResponseSchema.parse(rawSongData);

    if (songData.meta.status !== 200) {
        throw new Error(`Genius API returned status: ${songData.meta.status}`);
    }

    const song = songData.response.song;

    // Fetch the Genius page HTML to extract lyrics
    const pageResponse = await fetch(song.url);
    if (!pageResponse.ok) {
        throw new Error(`Failed to fetch Genius page: ${pageResponse.status}`);
    }

    const html = await pageResponse.text();
    const lyrics = extractLyricsFromHtml(html);

    return {
        id: song.id,
        title: song.title,
        artist: song.primary_artist.name,
        lyrics,
    };
}
