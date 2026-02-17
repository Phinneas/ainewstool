# Salish - AI Newsletter Generator

An automated AI newsletter generation system that ingests content from 17+ sources and produces a curated, publication-ready newsletter using a multi-LLM pipeline.

## How It Works

The system operates in two independent phases:

### Phase 1: Ingestion

Fetches content from RSS feeds, JSON feeds, Reddit, and official blogs. Each item is scraped via Firecrawl, evaluated for AI relevance by Mistral, enriched with external source links, and stored in Cloudflare R2 (S3-compatible).

### Phase 2: Generation

Loads ingested content for a given date, selects the top 4 stories (Kimi K2), generates a subject line, writes each section (Claude), and assembles the final markdown newsletter.

## Architecture

```
Ingestion Pipeline                    Generation Pipeline
─────────────────                    ────────────────────
RSS/JSON/Reddit Feeds                S3 Content for Date
        │                                    │
   Fetch Items                        Load Entries
        │                                    │
   Scrape (Firecrawl)                Select Top 4 Stories (Kimi K2)
        │                                    │
   Evaluate Relevance (Mistral)      Generate Subject Line (Kimi K2)
        │                                    │
   Extract Sources (Mistral)         Write Story Sections (Claude)
        │                                    │
   Store in S3/R2                    Write Intro (Claude)
                                             │
                                     Write Shortlist (Claude)
                                             │
                                     Assemble Markdown
```

## Sources

| Category | Sources |
|----------|---------|
| Newsletters (6) | The Rundown AI, The Neuron, Futurepedia, Superhuman, TAAFT, Ben's Bites |
| News Aggregators (2) | Google News (AI), Hacker News |
| Reddit (3) | r/OpenAI, r/ArtificialIntelligence, r/artificial |
| Official Blogs (6) | OpenAI, NVIDIA, Google AI, Anthropic, Cloudflare, Meta |

> Newsletters are ingested for reference but excluded from generation to avoid repackaging other newsletters.

## LLM Division of Labor

| Model | Provider | Role |
|-------|----------|------|
| Kimi K2 | Moonshot | Story selection and subject line generation (long-context reasoning) |
| Claude Sonnet 4.5 | Anthropic | Newsletter section writing, intro, and shortlist (creative writing) |
| Mistral Large | Mistral | Content relevance evaluation and external source extraction (fast utility) |

## Setup

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Environment Variables

Copy the example env file and fill in your API keys:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `S3_ENDPOINT` | Yes | Cloudflare R2 endpoint (`https://<account-id>.r2.cloudflarestorage.com`) |
| `S3_ACCESS_KEY_ID` | Yes | R2 access key |
| `S3_SECRET_ACCESS_KEY` | Yes | R2 secret key |
| `S3_BUCKET` | No | Bucket name (default: `data-ingestion`) |
| `S3_REGION` | No | Region (default: `auto`) |
| `FIRECRAWL_API_KEY` | Yes | Firecrawl API key for web scraping |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (Claude Sonnet 4.5) |
| `MISTRAL_API_KEY` | Yes | Mistral API key (Mistral Large) |
| `MOONSHOT_API_KEY` | Yes | Moonshot API key (Kimi K2) |
| `REDDIT_CLIENT_ID` | No | Reddit app client ID (needed for subreddit feeds) |
| `REDDIT_CLIENT_SECRET` | No | Reddit app client secret |
| `RESEND_API_KEY` | No (for email) | Resend API key for email delivery |
| `NEWSLETTER_RECIPIENTS` | No (for email) | Comma-separated list of recipient email addresses |

## Usage

### Ingest content

Fetches all feeds, scrapes URLs, evaluates relevance, and stores to S3:

```bash
npm run ingest
```

### Generate newsletter

Generate a newsletter for a specific date (content must already be ingested):

```bash
npm run generate 2026-02-10
```

Generate with deduplication against a previous newsletter:

```bash
npm run generate 2026-02-10 ./newsletter-2026-02-09.md
```

The generated newsletter is written to `newsletter-YYYY-MM-DD.md` in the project root.

### Send newsletter via email

Send a generated newsletter to a single recipient:

```bash
npm run email 2026-02-10 recipient@example.com
```

Or send to all recipients defined in `NEWSLETTER_RECIPIENTS`:

```bash
npm run send 2026-02-10
```

The `NEWSLETTER_RECIPIENTS` environment variable should contain comma-separated email addresses:

```bash
NEWSLETTER_RECIPIENTS="user1@example.com,user2@example.com,user3@example.com"
```

### Build TypeScript

```bash
npm run build
```

## Newsletter Format

Each generated newsletter follows this structure:

1. **Subject line** - 7-9 word headline focused on the lead story
2. **Pre-header text** - "PLUS:" teaser for other stories
3. **Intro** - Greeting, 2 paragraphs, bulleted story summary
4. **Story sections (4)** - Each with "The Scoop", "Unpacked" (3 bullets), and "Bottom line"
5. **The Quick Scribbles** - 3-5 additional stories in Rundown-style format

See [`examples/sample-newsletter-2026-02-10.md`](examples/sample-newsletter-2026-02-10.md) for a complete output example.

## S3 Storage Structure

Ingested content is stored as:

```
YYYY-MM-DD/
  slugified-title.source-name.md     # Markdown content
  slugified-title.source-name.html   # Raw HTML backup
```

Each file includes S3 metadata: `key`, `type`, `title`, `authors`, `source-name`, `external-source-urls`, `image-urls`, `url`, `timestamp`, `feed-url`.

## Testing

Run the test suite:

```bash
npm test
```

Tests cover:
- Content normalization and slug generation
- Google News domain resolution
- Reddit link filtering and post ID extraction
- Newsletter assembly
- LLM response parsing (all generation modules)
- Feed definition validation

## Project Structure

```
src/
  cli.ts                    # CLI entry point (ingest | generate)
  config.ts                 # Environment configuration
  llm/
    types.ts                # LLM client interface
    anthropic.ts            # Claude Sonnet 4.5 client
    mistral.ts              # Mistral Large client
    kimi.ts                 # Moonshot Kimi K2 client
  storage/
    types.ts                # Content and metadata types
    s3.ts                   # S3/R2 operations with retry logic
  ingest/
    index.ts                # Ingestion orchestrator
    feeds.ts                # Feed definitions (17 sources)
    normalize.ts            # Feed item normalization
    scrape.ts               # Firecrawl integration
    evaluate.ts             # AI relevance evaluation (Mistral)
    extract-sources.ts      # External link extraction (Mistral)
    reddit.ts               # Reddit API integration
  generate/
    index.ts                # Generation orchestrator
    select-stories.ts       # Top story selection (Kimi K2)
    subject-line.ts         # Subject line generation (Kimi K2)
    write-intro.ts          # Intro section (Claude)
    write-section.ts        # Story sections (Claude)
    write-shortlist.ts      # Shortlist section (Claude)
    assemble.ts             # Final markdown assembly
examples/
  sample-newsletter-2026-02-10.md  # Sample output
```
