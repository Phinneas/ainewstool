/**
 * Ideogram story image generator
 * Generates a single editorial illustration per newsletter story section.
 * Returns null on any failure — image generation is always non-fatal.
 */

const IDEOGRAM_API_URL = 'https://api.ideogram.ai/generate';

interface IdeogramResponse {
  data: Array<{ url: string }>;
}

/**
 * Generate an editorial illustration for a newsletter story.
 * Uses Ideogram V2 with a prompt designed to produce clean, dark tech-aesthetic
 * images with no text (to avoid conflicting with the newsletter copy).
 */
export async function generateStoryImage(
  headline: string,
  summary: string,
  apiKey: string
): Promise<string | null> {
  try {
    const prompt =
      `Editorial illustration for an AI and technology newsletter article: "${headline}". ` +
      `${summary ? summary.slice(0, 120) + '. ' : ''}` +
      `Minimalist dark tech aesthetic, deep navy and cyan tones, abstract and conceptual. ` +
      `No text, no words, no labels, no letters anywhere in the image.`;

    const response = await fetch(IDEOGRAM_API_URL, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_request: {
          prompt,
          aspect_ratio: 'ASPECT_16_9',
          model: 'V_2',
          magic_prompt_option: 'OFF', // Keep prompt as-is, don't let Ideogram modify it
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[StoryImage] Ideogram API error ${response.status}: ${errorText}`);
      return null;
    }

    const data = (await response.json()) as IdeogramResponse;
    const url = data?.data?.[0]?.url ?? null;

    if (!url) {
      console.error('[StoryImage] No image URL in Ideogram response');
      return null;
    }

    console.log(`[StoryImage] ✓ Generated image for: ${headline.slice(0, 60)}`);
    return url;

  } catch (error) {
    console.error('[StoryImage] Generation failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
