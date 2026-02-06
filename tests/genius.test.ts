import { describe, it, expect, beforeEach, vi } from "vitest";
import { searchSongs, getLyricsById, type Env } from "../src/lib/genius";

// Mock DOMPurify - the actual library doesn't work in Workers test environment
vi.mock("isomorphic-dompurify", () => ({
    default: {
        sanitize: (html: string) => html, // Pass-through for tests
    },
}));

// Mock fetch globally
const mockFetch = vi.mocked(vi.fn() as typeof fetch);
global.fetch = mockFetch;

// Mock environment variable
const MOCK_API_KEY = "test-genius-api-key";
const mockEnv: Env = { SECRET_GENIUS_API_KEY: MOCK_API_KEY };

describe("genius", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("searchSongs", () => {
        it("should return array of song search results", async () => {
            const mockResponse = {
                meta: { status: 200 },
                response: {
                    hits: [
                        {
                            result: {
                                id: 103365,
                                title: "Shake It Off",
                                primary_artist: { name: "Taylor Swift" },
                                song_art_image_url: "https://images.genius.com/abc123.jpg",
                                url: "https://genius.com/Taylor-swift-shake-it-off-lyrics",
                            },
                        },
                        {
                            result: {
                                id: 103366,
                                title: "Shake It Off (Remix)",
                                primary_artist: { name: "Taylor Swift" },
                                song_art_image_url: "https://images.genius.com/def456.jpg",
                                url: "https://genius.com/Taylor-swift-shake-it-off-remix-lyrics",
                            },
                        },
                    ],
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            } as Response);

            const results = await searchSongs("Taylor Swift Shake It Off", mockEnv);

            expect(results).toEqual([
                {
                    id: 103365,
                    title: "Shake It Off",
                    artist: "Taylor Swift",
                    albumArt: "https://images.genius.com/abc123.jpg",
                    url: "https://genius.com/Taylor-swift-shake-it-off-lyrics",
                },
                {
                    id: 103366,
                    title: "Shake It Off (Remix)",
                    artist: "Taylor Swift",
                    albumArt: "https://images.genius.com/def456.jpg",
                    url: "https://genius.com/Taylor-swift-shake-it-off-remix-lyrics",
                },
            ]);

            // Check that fetch was called with correct URL (accept both + and %20 encoding)
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringMatching(
                    /api\.genius\.com\/search\?q=(Taylor%20Swift%20Shake%20It%20Off|Taylor\+Swift\+Shake\+It\+Off)/
                ),
                {
                    headers: {
                        Authorization: `Bearer ${MOCK_API_KEY}`,
                    },
                }
            );
        });

        it("should return empty array when no results found", async () => {
            const mockResponse = {
                meta: { status: 200 },
                response: { hits: [] },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            } as Response);

            const results = await searchSongs("Nonexistent Song", mockEnv);

            expect(results).toEqual([]);
        });

        it("should throw error when API returns non-200 status", async () => {
            const mockResponse = {
                meta: { status: 401 },
                response: { hits: [] },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            } as Response);

            await expect(searchSongs("test", mockEnv)).rejects.toThrow(
                "Genius API returned status: 401"
            );
        });

        it("should throw error when fetch fails", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            } as Response);

            await expect(searchSongs("test", mockEnv)).rejects.toThrow(
                "Genius API error: 500 Internal Server Error"
            );
        });

        it("should throw error when env not provided", async () => {
            await expect(searchSongs("test")).rejects.toThrow(
                "SECRET_GENIUS_API_KEY environment variable is not set"
            );
        });
    });

    describe("getLyricsById", () => {
        const mockSongApiResponse = {
            meta: { status: 200 },
            response: {
                song: {
                    id: 103365,
                    title: "Shake It Off",
                    url: "https://genius.com/Taylor-swift-shake-it-off-lyrics",
                    primary_artist: { name: "Taylor Swift" },
                },
            },
        };

        const mockLyricsHtml = `
            <html>
                <body>
                    <div data-lyrics-container="true" class="lyrics">
                        <p>I stay out too late</p>
                        <p>Got nothing in my brain</p>
                        <p>That's what people say</p>
                    </div>
                    <div data-lyrics-container="true">
                        <p>You'll never miss me</p>
                        <p>Cause I'm a good time</p>
                    </div>
                </body>
            </html>
        `;

        it("should return song with lyrics", async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockSongApiResponse,
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => mockLyricsHtml,
                } as Response);

            const result = await getLyricsById(103365, mockEnv);

            // Check the expected fields, lyrics may have extra whitespace
            expect(result.id).toBe(103365);
            expect(result.title).toBe("Shake It Off");
            expect(result.artist).toBe("Taylor Swift");
            expect(result.lyrics).toContain("I stay out too late");
            expect(result.lyrics).toContain("Got nothing in my brain");
            expect(result.lyrics).toContain("That's what people say");
            expect(result.lyrics).toContain("You'll never miss me");
            expect(result.lyrics).toContain("Cause I'm a good time");

            expect(mockFetch).toHaveBeenNthCalledWith(1, "https://api.genius.com/songs/103365", {
                headers: {
                    Authorization: `Bearer ${MOCK_API_KEY}`,
                },
            });
            expect(mockFetch).toHaveBeenNthCalledWith(
                2,
                "https://genius.com/Taylor-swift-shake-it-off-lyrics"
            );
        });

        it("should handle lyrics with br tags", async () => {
            const htmlWithBr = `
                <div data-lyrics-container="true">
                    Line 1<br/>Line 2<br/>Line 3
                </div>
            `;

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockSongApiResponse,
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => htmlWithBr,
                } as Response);

            const result = await getLyricsById(103365, mockEnv);

            expect(result.lyrics).toContain("Line 1\nLine 2\nLine 3");
        });

        it("should throw error when song API returns non-200 status", async () => {
            const errorResponse = {
                meta: { status: 404 },
                response: {
                    song: {
                        id: 0,
                        title: "",
                        url: "",
                        primary_artist: { name: "" },
                    },
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => errorResponse,
            } as Response);

            await expect(getLyricsById(999999, mockEnv)).rejects.toThrow(
                "Genius API returned status: 404"
            );
        });

        it("should throw error when page fetch fails", async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockSongApiResponse,
                } as Response)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 404,
                } as Response);

            await expect(getLyricsById(103365, mockEnv)).rejects.toThrow(
                "Failed to fetch Genius page: 404"
            );
        });

        it("should throw error when lyrics cannot be extracted", async () => {
            const htmlWithoutLyrics = `
                <html>
                    <body>
                        <div class="some-other-div">No lyrics here</div>
                    </body>
                </html>
            `;

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockSongApiResponse,
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => htmlWithoutLyrics,
                } as Response);

            await expect(getLyricsById(103365, mockEnv)).rejects.toThrow(
                "Could not extract lyrics from page"
            );
        });

        it("should decode HTML entities in lyrics", async () => {
            const htmlWithEntities = `
                <div data-lyrics-container="true">
                    <p>&amp; &lt; &gt; &quot; &#x27;</p>
                </div>
            `;

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockSongApiResponse,
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => htmlWithEntities,
                } as Response);

            const result = await getLyricsById(103365, mockEnv);

            expect(result.lyrics).toContain("& < > \" '");
        });

        it("should decode numeric HTML entities in lyrics", async () => {
            const htmlWithNumericEntities = `
                <div data-lyrics-container="true">
                    <p>&#72;&#101;&#108;&#108;&#111;</p>
                </div>
            `;

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockSongApiResponse,
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => htmlWithNumericEntities,
                } as Response);

            const result = await getLyricsById(103365, mockEnv);

            expect(result.lyrics).toContain("Hello");
        });

        it("should throw error when env not provided", async () => {
            await expect(getLyricsById(103365)).rejects.toThrow(
                "SECRET_GENIUS_API_KEY environment variable is not set"
            );
        });
    });
});
