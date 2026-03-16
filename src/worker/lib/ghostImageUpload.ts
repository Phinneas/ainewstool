/**
 * Ghost Admin API image upload utility.
 * Uploads a PNG buffer to Ghost's /images/upload/ endpoint and returns
 * the public URL, which can be used as feature_image in post creation
 * and as thumbnail_url in Beehiiv post creation.
 */

interface GhostImageUploadResponse {
  images: Array<{ url: string; ref?: string }>;
}

/**
 * Upload a PNG buffer to Ghost's media library.
 * Returns the public image URL, or null on failure.
 */
export async function uploadImageToGhost(
  pngBytes: ArrayBuffer,
  filename: string,
  jwt: string,
  ghostUrl: string
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([pngBytes], { type: 'image/png' }),
      filename
    );
    form.append('purpose', 'image');
    form.append('ref', filename);

    const url = `${ghostUrl}/ghost/api/admin/images/upload/`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Ghost ${jwt}`,
        'Accept-Version': 'v5.0',
        // Do NOT set Content-Type — browser/Workers sets multipart boundary automatically
      },
      body: form,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GhostImageUpload] API error ${response.status}: ${errorText}`);
      return null;
    }

    const data = (await response.json()) as GhostImageUploadResponse;
    const imageUrl = data?.images?.[0]?.url ?? null;

    if (!imageUrl) {
      console.error('[GhostImageUpload] No URL in response');
      return null;
    }

    console.log(`[GhostImageUpload] ✓ Uploaded: ${imageUrl}`);
    return imageUrl;

  } catch (error) {
    console.error('[GhostImageUpload] Upload failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
