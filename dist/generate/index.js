import * as s3 from "../storage/s3.js";
import { log } from "../logger.js";
import { scrapeUrl } from "../ingest/scrape.js";
import { selectTopStories } from "./select-stories.js";
import { generateSubjectLine } from "./subject-line.js";
import { writeSection } from "./write-section.js";
import { writeIntro } from "./write-intro.js";
import { writeShortlist } from "./write-shortlist.js";
import { assembleNewsletter } from "./assemble.js";
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
            // Skip newsletters — we only want articles and subreddit posts
            if (metadata.type === "newsletter")
                continue;
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
    log.info(`Loaded ${entries.length} content entries (excluding newsletters)`);
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
export async function generateNewsletter(date, previousNewsletter) {
    log.info("Starting Newsletter Generation");
    const totalTimer = log.timer("newsletter-generation");
    // Step 1: Load all content for the date
    const loadTimer = log.timer("load-content");
    const entries = await loadContentForDate(date);
    loadTimer.end();
    if (entries.length === 0) {
        throw new Error(`No content found for date: ${date}`);
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
    const subjectResult = await generateSubjectLine(selection.stories, entries, date);
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
            date,
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
        date,
    });
    introTimer.end();
    // Step 6: Write "The Quick Scribbles" via Claude
    log.info("Writing shortlist...");
    const shortlistTimer = log.timer("write-shortlist");
    const allContentText = entries
        .map((e) => `<${e.identifier}>\n---\nidentifier: ${e.identifier}\nsourceName: ${e.sourceName}\nurl: ${e.metadata.url ?? ""}\n---\n\nTitle: ${e.title}\n\n${e.content.substring(0, 500)}...\n</${e.identifier}>`)
        .join("\n\n");
    const shortlist = await writeShortlist({
        subjectLine: subjectResult.subjectLine,
        storySections: combinedSections,
        allContent: allContentText,
        previousNewsletter,
        date,
    });
    shortlistTimer.end();
    // Step 7: Assemble final newsletter
    log.info("Assembling newsletter...");
    const newsletter = assembleNewsletter({
        subjectLine: subjectResult.subjectLine,
        preHeaderText: subjectResult.preHeaderText,
        intro,
        storySections,
        shortlist,
    });
    totalTimer.end();
    log.info("Newsletter Generation Complete");
    return newsletter;
}
