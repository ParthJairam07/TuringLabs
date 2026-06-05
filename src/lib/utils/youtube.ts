const YOUTUBE_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export type ParsedYouTubeUrl = {
  url: string;
  videoId: string;
};

export function parseYouTubeUrl(rawUrl: string): ParsedYouTubeUrl | null {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (!YOUTUBE_HOSTS.has(host)) {
      return null;
    }

    let videoId: string | null = null;

    if (host === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else {
      const parts = parsed.pathname.split("/").filter(Boolean);

      if (parts[0] === "shorts" || parts[0] === "embed") {
        videoId = parts[1] ?? null;
      }
    }

    if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
      return null;
    }

    return {
      url: trimmed,
      videoId,
    };
  } catch {
    return null;
  }
}

export function parseYouTubeUrls(urls: string[]) {
  return urls.map((url) => ({
    rawUrl: url,
    parsed: parseYouTubeUrl(url),
  }));
}

export function dedupeParsedUrls(urls: ParsedYouTubeUrl[]) {
  const seen = new Set<string>();

  return urls.filter((item) => {
    if (seen.has(item.videoId)) {
      return false;
    }

    seen.add(item.videoId);
    return true;
  });
}

export function getMaxResThumbnailUrl(videoId: string) {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

export function getHighQualityThumbnailUrl(videoId: string) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}
