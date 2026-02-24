export interface GhostPost {
  id: string;
  uuid: string;
  title: string;
  slug: string;
  mobiledoc: string;
  html: string;
  comment_id: string;
  feature_image: string | null;
  featured: boolean;
  visibility: string;
  created_at: string;
  updated_at: string;
  published_at: string;
  custom_excerpt: string | null;
  codeinjection_head: string | null;
  codeinjection_foot: string | null;
  custom_template: string | null;
  canonical_url: string | null;
  tags: Array<{ id: string; name: string; slug: string }>;
  authors: Array<{ id: string; name: string; slug: string }>;
  primary_author: {
    id: string;
    name: string;
    slug: string;
  };
  primary_tag: {
    id: string;
    name: string;
    slug: string;
  } | null;
  url: string;
  excerpt: string;
  reading_time: number;
  access: boolean;
  og_image: string | null;
  og_title: string | null;
  twitter_image: string | null;
  twitter_title: string | null;
  meta_title: string | null;
  meta_description: string | null;
  email_subject: string | null;
  frontend: boolean;
}

export interface CreateGhostPostRequest {
  title: string;
  mobiledoc: string;
  status?: "draft" | "published";
  tags?: string[];
  feature_image?: string;
  custom_excerpt?: string;
}

export interface GhostResponse<T> {
  posts: T[];
  meta?: {
    pagination: {
      page: number;
      limit: number;
      pages: number;
      total: number;
      next: number | null;
      prev: number | null;
    };
  };
}

export interface GhostErrorResponse {
  errors: Array<{
    message: string;
    type?: string;
  }>;
}
