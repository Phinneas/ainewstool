/**
 * Global type definitions for Cloudflare Workers
 */

declare global {
  type Queue<T> = {
    send(message: T): Promise<void>;
    sendBatch(messages: { body: T }[]): Promise<void>;
  };

  type MessageBatch<T> = {
    queue: string;
    messages: { id: string; timestamp: Date; body: T }[];
  };

  type R2Bucket = {
    get(key: string): Promise<R2Object | null>;
    put(key: string, value: string | ArrayBuffer | ReadableStream, options?: R2PutOptions): Promise<R2Object>;
    delete(key: string): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
  };

  type KVNamespace = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult>;
  };

  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }

  interface ScheduledEvent {
    scheduledTime: number;
    cron: string;
  }

  interface R2Object {
    key: string;
    httpEtag: string;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }

  interface R2PutOptions {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }

  interface R2ListOptions {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }

  interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }

  interface KVNamespacePutOptions {
    expiration?: number;
    expirationTtl?: number;
    metadata?: Record<string, any>;
  }

  interface KVNamespaceListOptions {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }

  interface KVNamespaceListResult {
    keys: { name: string; expiration?: number; metadata?: any }[];
    list_complete: boolean;
    cursor?: string;
  }
}

export {};
