/**
 * Satori-based newsletter header image generator.
 * Produces a 1200×400 PNG branded header for each newsletter issue:
 *   [BrainScriblr logo]  |  BrainScriblr
 *                           ━━━━━━━━━━━━━━  (cyan→purple gradient line)
 *                           <date>
 *                           <top headline tease>
 *
 * The logo PNG is bundled as a base64 data URL at build time (src/assets/logo.ts)
 * so no external fetch is needed for the logo.
 *
 * Noto Sans font is fetched from Google Fonts on first use and cached in KV
 * for 30 days to avoid repeated external calls.
 */

import satori from '@cf-wasm/satori';
import { Resvg } from '@cf-wasm/resvg';
import { LOGO_DATA_URL } from '../../assets/logo.js';

// Brand colours extracted from the BrainScriblr logo
const BRAND = {
  bg:            '#0d0f2b',
  gradientFrom:  '#5CE8E4',   // cyan (left side of logo)
  gradientTo:    '#8040BF',   // purple (right side of logo)
  textPrimary:   '#FFFFFF',
  textMuted:     '#9999CC',
} as const;

const FONT_KV_KEY = 'config:font:noto-sans';
const FONT_URL    = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr6zRAW_0.ttf';
const FONT_TTL    = 60 * 60 * 24 * 30; // 30 days

// Module-level font cache — survives across invocations in the same Worker instance
let _fontCache: ArrayBuffer | null = null;

async function getFont(kv?: KVNamespace): Promise<ArrayBuffer> {
  if (_fontCache) return _fontCache;

  // KV cache — stored as base64 string since the project KV type only supports string values
  if (kv) {
    const cached = await kv.get(FONT_KV_KEY);
    if (cached) {
      const bytes = Uint8Array.from(atob(cached), c => c.charCodeAt(0));
      _fontCache = bytes.buffer as ArrayBuffer;
      return _fontCache;
    }
  }

  // Fetch from Google Fonts
  const res = await fetch(FONT_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();

  if (kv) {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    await kv.put(FONT_KV_KEY, b64, { expirationTtl: FONT_TTL });
  }

  _fontCache = buffer;
  return buffer;
}

/** Minimal JSX-compatible vnode builder — avoids requiring JSX transpilation */
function h(
  type: string,
  props: Record<string, unknown>,
  ...children: unknown[]
): object {
  const resolvedChildren =
    children.length === 0 ? undefined :
    children.length === 1 ? children[0] :
    children;
  return {
    type,
    props: resolvedChildren !== undefined
      ? { ...props, children: resolvedChildren }
      : props,
  };
}

/**
 * Generate a 1200×400 PNG newsletter header.
 * Returns an ArrayBuffer on success, or null if generation fails.
 */
export async function generateHeaderImage(data: {
  newsletterName: string;
  date: string;
  topHeadline: string;
  kv?: KVNamespace;
}): Promise<ArrayBuffer | null> {
  try {
    const font = await getFont(data.kv);

    // Truncate headline to keep the layout clean
    const headline =
      data.topHeadline.length > 110
        ? data.topHeadline.slice(0, 107) + '…'
        : data.topHeadline;

    const tree = h('div', {
      style: {
        width: '1200px',
        height: '400px',
        backgroundColor: BRAND.bg,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        padding: '40px 64px',
        fontFamily: 'Noto Sans',
        boxSizing: 'border-box',
      },
    },
      // Left: Logo
      h('img', {
        src: LOGO_DATA_URL,
        style: {
          width: '220px',
          height: '220px',
          objectFit: 'contain',
          marginRight: '56px',
          flexShrink: 0,
        },
      }),

      // Right: text column
      h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          gap: '0px',
        },
      },
        // Newsletter name
        h('div', {
          style: {
            fontSize: '58px',
            fontWeight: 700,
            color: BRAND.textPrimary,
            letterSpacing: '-1px',
            lineHeight: 1.1,
            marginBottom: '16px',
          },
        }, data.newsletterName),

        // Gradient divider line (simulated with a div using a gradient background)
        h('div', {
          style: {
            display: 'flex',
            width: '100%',
            height: '3px',
            backgroundImage: `linear-gradient(to right, ${BRAND.gradientFrom}, ${BRAND.gradientTo})`,
            borderRadius: '2px',
            marginBottom: '16px',
          },
        }),

        // Date
        h('div', {
          style: {
            fontSize: '18px',
            color: BRAND.textMuted,
            letterSpacing: '0.5px',
            marginBottom: '16px',
          },
        }, data.date),

        // Top headline tease
        h('div', {
          style: {
            fontSize: '22px',
            color: BRAND.textPrimary,
            lineHeight: 1.45,
            opacity: 0.9,
          },
        }, headline),
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svg = await satori(tree as any, {
      width: 1200,
      height: 400,
      fonts: [{
        name: 'Noto Sans',
        data: font,
        weight: 400,
        style: 'normal',
      }],
    });

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
    });

    const rendered = resvg.render();
    const pngData  = rendered.asPng();

    console.log(`[HeaderImage] ✓ Generated 1200×400 header (${pngData.byteLength} bytes)`);
    return pngData.buffer as ArrayBuffer;

  } catch (error) {
    console.error('[HeaderImage] Generation failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
