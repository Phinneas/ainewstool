import * as s3 from "../storage/s3.js";
import { log } from "../logger.js";
import { scrapeUrl } from "../ingest/scrape.js";
import { selectTopStories } from "./select-stories.js";
import { generateSubjectLine } from "./subject-line.js";
import { writeSection } from "./write-section.js";
import { writeIntro } from "./write-intro.js";
import { writeShortlist } from "./write-shortlist.js";
import { assembleNewsletter } from "./assemble.js";
import { fetchFeaturedMCP, formatFeaturedMCPSection } from "../ingest/featured-mcp.js";
import { fetchAiForGoodStories, formatAiForGoodSection } from "./ai-for-good.js";
import { fetchAiDiscoveries, formatAiDiscoveriesSection } from "./ai-discoveries.js";
/**
 * Load content from S3 for a single date prefix (CLI usage).
 */
async function loadContentForDate(date) {
    log.info(`Loading content for date: ${date}`);
    const keys = await s3.list(`${date}/`);
    const mdKeys = keys.filter((k) => k.endsWith(".md"));
    log.info(`Found ${mdKeys.length} markdown files`);
    const entries = [];
    for (const key of mdKeys) {
        try {
            const [content, metadata] = await Promise.all([
                s3.download(key),
                s3.getMetadata(key),
            ]);
            entries.push({
                identifier: key,
                content,
                metadata,
                title: metadata.title ?? key,
                sourceName: metadata["source-name"] ?? "",
                type: metadata.type ?? "article",
                externalSourceUrls: metadata["external-source-urls"] ?? "",
            });
        }
        catch (err) {
            log.warn(`Failed to load ${key}`, { error: err instanceof Error ? err.message : String(err) });
        }
    }
    log.info(`Loaded ${entries.length} content entries`);
    return entries;
}
/**
 * Load content from an R2 bucket across multiple date prefixes (Worker usage).
 */
async function loadContentFromR2(dates, bucket) {
    log.info(`Loading content from R2 for ${dates.length} date(s)`);
    const entries = [];
    for (const date of dates) {
        const listed = await bucket.list({ prefix: `${date}_` });
        const mdKeys = listed.objects
            .map((o) => o.key)
            .filter((k) => k.endsWith(".md"));
        log.info(`  ${date}: ${mdKeys.length} files`);
        for (const key of mdKeys) {
            try {
                const obj = await bucket.get(key);
                if (!obj)
                    continue;
                const content = await obj.text();
                const metadata = (obj.customMetadata ?? {});
                entries.push({
                    identifier: key,
                    content,
                    metadata,
                    title: metadata.title ?? key,
                    sourceName: metadata["source-name"] ?? "",
                    type: metadata.type ?? "article",
                    externalSourceUrls: metadata["external-source-urls"] ?? "",
                });
            }
            catch (err) {
                log.warn(`Failed to load ${key} from R2`, { error: err instanceof Error ? err.message : String(err) });
            }
        }
    }
    log.info(`Loaded ${entries.length} total content entries from R2`);
    return entries;
}
async function scrapeExternalSources(urls) {
    if (urls.length === 0)
        return "N/A";
    const results = [];
    for (const url of urls) {
        try {
            const result = await scrapeUrl(url);
            if (result) {
                results.push(`<${url}>\n---\nurl: ${url}\n---\n${result.content}\n</${url}>`);
            }
        }
        catch (err) {
            log.warn(`Failed to scrape external source`, { url, error: err instanceof Error ? err.message : String(err) });
        }
    }
    return results.length > 0 ? results.join("\n\n") : "N/A";
}
export async function generateNewsletter(dateOrDates, bucketOrPrevious, previousNewsletterArg) {
    log.info("Starting Newsletter Generation");
    const totalTimer = log.timer("newsletter-generation");
    // Resolve overloaded arguments:
    // CLI:    generateNewsletter("2026-02-21", previousNewsletter?)
    // Worker: generateNewsletter(["2026-02-21", ...], bucket, previousNewsletter?)
    const isWorker = Array.isArray(dateOrDates);
    const dates = isWorker ? dateOrDates : [dateOrDates];
    const displayDate = dates[0];
    const bucket = isWorker ? bucketOrPrevious : undefined;
    const previousNewsletter = isWorker
        ? previousNewsletterArg
        : bucketOrPrevious;
    // Step 1: Load all content
    const loadTimer = log.timer("load-content");
    const entries = isWorker
        ? await loadContentFromR2(dates, bucket)
        : await loadContentForDate(dates[0]);
    loadTimer.end();
    if (entries.length === 0) {
        throw new Error(`No content found for date range: ${dates.join(", ")}`);
    }
    // Step 2: Select top stories via Kimi K2
    log.info("Selecting top stories...");
    const selectTimer = log.timer("select-stories");
    const selection = await selectTopStories(entries, previousNewsletter);
    selectTimer.end();
    log.info(`Selected ${selection.stories.length} stories`);
    for (const story of selection.stories) {
        log.info(`  - ${story.title}`);
    }
    // Step 3: Generate subject line via Kimi K2
    log.info("Generating subject line...");
    const subjectTimer = log.timer("subject-line");
    const subjectResult = await generateSubjectLine(selection.stories, entries, displayDate);
    subjectTimer.end();
    log.info(`Subject: ${subjectResult.subjectLine}`);
    log.info(`Pre-header: ${subjectResult.preHeaderText}`);
    // Step 4: Write each story section via Claude
    log.info("Writing story sections...");
    const sectionsTimer = log.timer("write-sections");
    const storySections = [];
    for (const story of selection.stories) {
        log.info(`  Writing: ${story.title}`);
        // Gather content for all identifiers of this story
        const storyContent = story.identifiers
            .map((id) => {
            const entry = entries.find((e) => e.identifier === id);
            if (!entry)
                return "";
            return `<${id}>\n---\nidentifier: ${id}\nfriendlyType: ${entry.type}\nsourceName: ${entry.sourceName}\nauthors: ${entry.metadata.authors ?? ""}\nexternalSourceUrls: ${entry.externalSourceUrls}\nimageUrls: ${entry.metadata["image-urls"] ?? ""}\n---\n\n${entry.content}\n</${id}>`;
        })
            .filter(Boolean)
            .join("\n\n");
        // Scrape external sources if any
        const externalUrls = story.external_source_links.filter((u) => u && u.trim() !== "");
        const externalContent = await scrapeExternalSources(externalUrls);
        const section = await writeSection({
            story,
            storyContent,
            externalSourceContent: externalContent,
            subjectLine: subjectResult.subjectLine,
            preHeaderText: subjectResult.preHeaderText,
            date: displayDate,
        });
        storySections.push(section.content);
    }
    sectionsTimer.end();
    const combinedSections = storySections.join("\n\n---\n");
    // Step 5: Write intro section via Claude
    log.info("Writing intro...");
    const introTimer = log.timer("write-intro");
    const intro = await writeIntro({
        subjectLine: subjectResult.subjectLine,
        preHeaderText: subjectResult.preHeaderText,
        storySections: combinedSections,
        date: displayDate,
    });
    introTimer.end();
    // Step 6: Write "Quick Scribbles" TL;DR summary of main stories
    log.info("Writing shortlist...");
    const shortlistTimer = log.timer("write-shortlist");
    const allContentText = entries
        .map((e) => `<${e.identifier}>\n---\nidentifier: ${e.identifier}\nsourceName: ${e.sourceName}\nfeedType: ${e.type}\nurl: ${e.metadata.url ?? ""}\n---\n\nTitle: ${e.title}\n\n${e.content.substring(0, 500)}...\n</${e.identifier}>`)
        .join("\n\n");
    const shortlist = await writeShortlist({
        subjectLine: subjectResult.subjectLine,
        storySections: combinedSections,
        allContent: allContentText,
        previousNewsletter,
        date: displayDate,
    });
    shortlistTimer.end();
    // Step 7: Fetch supplemental sections in parallel (non-blocking)
    log.info("Fetching supplemental sections...");
    const supplementalTimer = log.timer("supplemental-sections");
    const [featuredMCP, aiForGoodStories, aiDiscoveryStories] = await Promise.all([
        fetchFeaturedMCP(),
        fetchAiForGoodStories(displayDate),
        fetchAiDiscoveries(displayDate),
    ]);
    supplementalTimer.end();
    const featuredMCPSection = featuredMCP ? formatFeaturedMCPSection(featuredMCP) : undefined;
    if (featuredMCP)
        log.info(`Featured MCP: ${featuredMCP.name}`);
    else
        log.warn("No featured MCP available for this issue");
    const aiForGoodSection = aiForGoodStories ? formatAiForGoodSection(aiForGoodStories) : undefined;
    if (aiForGoodStories)
        log.info(`AI for Good: ${aiForGoodStories.length} stories`);
    else
        log.warn("No AI for Good stories available for this issue");
    const aiDiscoveriesSection = aiDiscoveryStories ? formatAiDiscoveriesSection(aiDiscoveryStories) : undefined;
    if (aiDiscoveryStories)
        log.info(`AI Discoveries: ${aiDiscoveryStories.length} stories`);
    else
        log.warn("No AI Discoveries available for this issue");
    // Step 8: Assemble final newsletter
    log.info("Assembling newsletter...");
    const newsletter = assembleNewsletter({
        subjectLine: subjectResult.subjectLine,
        preHeaderText: subjectResult.preHeaderText,
        intro,
        storySections,
        shortlist,
        featuredMCP: featuredMCPSection,
        aiForGood: aiForGoodSection,
        aiDiscoveries: aiDiscoveriesSection,
    });
    totalTimer.end();
    log.info("Newsletter Generation Complete");
    return newsletter;
}
