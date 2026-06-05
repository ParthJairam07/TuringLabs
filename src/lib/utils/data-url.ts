export type DataUrlParts = {
  mimeType: string;
  base64: string;
};

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/;

export function parseDataUrl(dataUrl: string): DataUrlParts | null {
  const match = dataUrl.match(DATA_URL_PATTERN);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

export function estimateDataUrlBytes(dataUrl: string) {
  const parts = parseDataUrl(dataUrl);

  if (!parts) {
    return 0;
  }

  return Math.floor((parts.base64.length * 3) / 4);
}
