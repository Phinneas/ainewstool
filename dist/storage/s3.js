import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import { log } from "../logger.js";
const client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
    },
    forcePathStyle: true,
});
const bucket = config.s3.bucket;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetry(operation, fn) {
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            const isLastAttempt = attempt > MAX_RETRIES;
            if (isLastAttempt) {
                log.error(`S3 ${operation} failed after ${attempt} attempts`, { error: err instanceof Error ? err.message : String(err) });
                throw err;
            }
            log.warn(`S3 ${operation} failed, retrying`, { attempt, maxAttempts: MAX_RETRIES + 1, retryMs: RETRY_DELAY_MS * attempt, error: err instanceof Error ? err.message : String(err) });
            await sleep(RETRY_DELAY_MS * attempt);
        }
    }
    throw new Error("Unreachable");
}
export async function upload(key, content, contentType, metadata) {
    await withRetry(`upload(${key})`, () => client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType ?? "text/plain",
        Metadata: metadata,
    })));
}
export async function download(key) {
    const result = await withRetry(`download(${key})`, () => client.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
    return (await result.Body?.transformToString()) ?? "";
}
export async function list(prefix) {
    const result = await withRetry(`list(${prefix})`, () => client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
    })));
    return (result.Contents ?? []).map((obj) => obj.Key).filter(Boolean);
}
export async function exists(prefix) {
    const keys = await list(prefix);
    return keys.length > 0;
}
export async function del(key) {
    await withRetry(`delete(${key})`, () => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
}
export async function copy(srcKey, dstKey, newContentType, newMetadata) {
    await withRetry(`copy(${srcKey} -> ${dstKey})`, () => client.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${srcKey}`,
        Key: dstKey,
        ContentType: newContentType,
        Metadata: newMetadata,
        MetadataDirective: newMetadata ? "REPLACE" : "COPY",
    })));
}
export async function getMetadata(key) {
    const result = await withRetry(`getMetadata(${key})`, () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })));
    return result.Metadata ?? {};
}
export async function uploadWithMetadata(uploadFileName, markdownContent, htmlContent, metadata) {
    const metaRecord = {};
    for (const [k, v] of Object.entries(metadata)) {
        if (v != null)
            metaRecord[k] = String(v);
    }
    // Upload markdown directly with metadata
    await upload(`${uploadFileName}.md`, markdownContent, `application/vnd.aitools.${metadata.type}+md`, metaRecord);
    // Upload HTML directly with metadata
    await upload(`${uploadFileName}.html`, htmlContent, `application/vnd.aitools.${metadata.type}.raw+html`, metaRecord);
}
