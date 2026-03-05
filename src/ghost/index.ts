import { log } from "../logger.js";

function getGhostEnv() {
  const url = process.env.GHOST_API_URL;
  const adminKey = process.env.GHOST_ADMIN_API_KEY;
  const contentKey = process.env.GHOST_CONTENT_API_KEY;
  if (!url) throw new Error("GHOST_API_URL environment variable is not set");
  if (!adminKey) throw new Error("GHOST_ADMIN_API_KEY environment variable is not set");
  return { url, adminKey, contentKey };
}

/**
 * Create a Ghost Admin API JWT token.
 * Ghost Admin API keys are in "id:secret" format where secret is hex-encoded.
 * The JWT must be signed with the secret using HS256.
 */
async function createGhostJwt(adminKey: string): Promise<string> {
  const [id, secret] = adminKey.split(":");
  if (!id || !secret) {
    throw new Error("Invalid Ghost Admin API key format — expected id:secret");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", kid: id, typ: "JWT" };
  const payload = { iat: now, exp: now + 300, aud: "/admin/" };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Decode hex secret to raw bytes
  const secretBytes = new Uint8Array(
    secret.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
  );

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${sigB64}`;
}

/**
 * Create a new post in Ghost CMS using the Admin API
 */
export async function createPost(
  postData: {
    title: string;
    html?: string;
    mobiledoc?: string;
    status?: "draft" | "published";
    tags?: string[];
    feature_image?: string;
    custom_excerpt?: string;
  }
): Promise<string> {
  const { url: GHOST_API_URL, adminKey: GHOST_ADMIN_API_KEY } = getGhostEnv();
  const authHeader = await createGhostJwt(GHOST_ADMIN_API_KEY);
  const url = `${GHOST_API_URL}/ghost/api/admin/posts/`;

  log.info("Creating Ghost CMS post", {
    title: postData.title,
    status: postData.status || "draft",
  });

  const postBody: Record<string, unknown> = {
    title: postData.title,
    status: postData.status || "draft",
    tags: postData.tags || [],
    feature_image: postData.feature_image || null,
    custom_excerpt: postData.custom_excerpt || null,
  };
  if (postData.mobiledoc) {
    postBody.mobiledoc = postData.mobiledoc;
  } else if (postData.html) {
    postBody.html = postData.html;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Ghost ${authHeader}`,
        "Accept-Version": "v5.0",
      },
      body: JSON.stringify({ posts: [postBody] }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error("Failed to create Ghost post", {
        status: response.status,
        error: errorText,
      });
      throw new Error(`Failed to create Ghost post: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { posts: Array<{ id: string; url: string }> };
    const post = data.posts[0];

    log.info("Ghost CMS post created successfully", {
      postId: post.id,
      url: post.url,
    });

    return post.id;
  } catch (error) {
    log.error("Error creating Ghost post", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get posts from Ghost CMS using the Content API
 */
export async function getPosts(options: {
  limit?: number;
  page?: number;
  include?: string[];
  filter?: string;
}): Promise<any[]> {
  const { url: GHOST_API_URL, contentKey: GHOST_CONTENT_API_KEY } = getGhostEnv();
  if (!GHOST_CONTENT_API_KEY) throw new Error("GHOST_CONTENT_API_KEY environment variable is not set");
  const url = new URL(`${GHOST_API_URL}/ghost/api/content/posts/`);
  url.searchParams.append("key", GHOST_CONTENT_API_KEY);

  if (options.limit) url.searchParams.append("limit", options.limit.toString());
  if (options.page) url.searchParams.append("page", options.page.toString());
  if (options.include && options.include.length > 0) {
    url.searchParams.append("include", options.include.join(","));
  }
  if (options.filter) {
    url.searchParams.append("filter", options.filter);
  }

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorText = await response.text();
      log.error("Failed to get Ghost posts", {
        status: response.status,
        error: errorText,
      });
      throw new Error(`Failed to get Ghost posts: ${response.status}`);
    }

    const data = (await response.json()) as { posts: any[] };
    return data.posts;
  } catch (error) {
    log.error("Error getting Ghost posts", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Update an existing post in Ghost CMS
 */
export async function updatePost(
  postId: string,
  updateData: {
    title?: string;
    html?: string;
    status?: "draft" | "published";
    tags?: string[];
    feature_image?: string;
    custom_excerpt?: string;
  }
): Promise<string> {
  const { url: GHOST_API_URL, adminKey: GHOST_ADMIN_API_KEY } = getGhostEnv();
  const authHeader = await createGhostJwt(GHOST_ADMIN_API_KEY);
  const url = `${GHOST_API_URL}/ghost/api/admin/posts/${postId}/`;

  log.info("Updating Ghost CMS post", { postId });

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Ghost ${authHeader}`,
        "Accept-Version": "v5.0",
      },
      body: JSON.stringify({
        posts: [
          {
            id: postId,
            ...updateData,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error("Failed to update Ghost post", {
        status: response.status,
        error: errorText,
      });
      throw new Error(`Failed to update Ghost post: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { posts: Array<{ id: string }> };
    log.info("Ghost CMS post updated successfully", { postId });
    return data.posts[0].id;
  } catch (error) {
    log.error("Error updating Ghost post", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete a post from Ghost CMS
 */
export async function deletePost(postId: string): Promise<boolean> {
  const { url: GHOST_API_URL, adminKey: GHOST_ADMIN_API_KEY } = getGhostEnv();
  const authHeader = await createGhostJwt(GHOST_ADMIN_API_KEY);
  const url = `${GHOST_API_URL}/ghost/api/admin/posts/${postId}/`;

  log.info("Deleting Ghost CMS post", { postId });

  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Ghost ${authHeader}`,
        "Accept-Version": "v5.0",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error("Failed to delete Ghost post", {
        status: response.status,
        error: errorText,
      });
      return false;
    }

    log.info("Ghost CMS post deleted successfully", { postId });
    return true;
  } catch (error) {
    log.error("Error deleting Ghost post", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
