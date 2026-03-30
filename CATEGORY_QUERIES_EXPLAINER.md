# Category-Specific Search Queries Explainer

## Current Approach: Generic Mixed Queries

Your current system generates **one batch of 8-12 generic queries** covering everything:

```typescript
// Current: generate-queries.ts
// Generates 8-12 queries like:
[
  "latest AI model release announcement today",
  "AI startup funding round 2025",
  "AI regulation policy news",
  "fine-tuning LLM tutorial step by step",
  // ... mixed topics
]
```

**Problems:**
1. **Broad searches miss depth** - A generic "AI funding" query might find mainstream news but miss niche Series A announcements
2. **No specialized treatment** - Policy queries need different search engines than product launches
3. **Timeframes are uniform** - Funding news might need 5-day lookback, but policy updates need 14-day lookback
4. **Search engines aren't optimized** - You're using the same search approach for all content types

**Note:** Firecrawl is being removed from discovery search per `docs/firecrawl-cost-reduction-spec.md`. The scraping layer already uses **Jina Reader + native fetch** (free).

---

## Proposed Approach: Category-Specific Queries

**Break queries into specialized categories**, each with:
- Targeted query language
- Optimized search engine (Exa for academic, Tavily for news, Firecrawl for web)
- Appropriate date ranges
- Different concurrency/priority

### Example: 5 Category Query Sets

```typescript
interface CategoryQuerySet {
  category: 'policy' | 'funding' | 'consumer' | 'enterprise' | 'research';
  queries: string[];
  searchEngine: 'firecrawl' | 'exa' | 'tavily';
  dateRange: { daysBack: number };
  priority: 'high' | 'medium' | 'low';
}
```

#### Category 1: Policy & Regulation
```json
{
  "category": "policy",
  "queries": [
    "FDA AI medical device approval guidelines 2025",
    "EU AI Act implementation deadline update",
    "NIST AI risk management framework new standards",
    "FTC consumer protection AI enforcement action",
    "US federal AI procurement policy announced"
  ],
  "searchEngine": "exa",
  "dateRange": { "daysBack": 14 },
  "priority": "high"
}
```
**Why Exa?** Exa excels at finding authoritative documents, regulatory filings, and academic content

**Why 14 days?** Policy moves slowly - you want to catch developments over weeks

#### Category 2: Funding & Acquisitions
```json
{
  "category": "funding",
  "queries": [
    "AI startup Series A B C funding announcement this week",
    "artificial intelligence company acquisition 2025",
    "venture capital AI investment round disclosed",
    "Silicon Valley AI unicorn valuation increase",
    "enterprise AI startup raises funding"
  ],
  "searchEngine": "tavily",
  "dateRange": { "daysBack": 5 },
  "priority": "high"
}
```
**Why Tavily?** Great for real-time news and press releases

**Why 5 days?** Funding news ages fast - older stories become irrelevant

#### Category 3: Consumer AI & Apps
```json
{
  "category": "consumer",
  "queries": [
    "ChatGPT alternative consumer app launched 2025",
    "AI photo editing app trending this week",
    "new AI assistant mobile app released",
    "consumer AI product launch announcement",
    "AI-powered app feature update viral"
  ],
  "searchEngine": "tavily",
  "dateRange": { "daysBack": 3 },
  "priority": "medium"
}
```
**Why Tavily?** Great for consumer tech news and product announcements

**Why 3 days?** Consumer trends move very fast

#### Category 4: Enterprise & B2B AI
```json
{
  "category": "enterprise",
  "queries": [
    "enterprise AI platform partnership announced",
    "B2B AI software integration new feature",
    "corporate AI deployment case study",
    "Fortune 500 AI adoption announcement",
    "enterprise AI tool partnership Microsoft Google"
  ],
  "searchEngine": "tavily",
  "dateRange": { "daysBack": 7 },
  "priority": "medium"
}
```

#### Category 5: Research & Technical
```json
{
  "category": "research",
  "queries": [
    "AI research paper breakthrough arxiv this week",
    "new AI model architecture published 2025",
    "machine learning benchmark results announced",
    "AI training technique optimization paper",
    "deep learning research open source released"
  ],
  "searchEngine": "exa",
  "dateRange": { "daysBack": 7 },
  "priority": "low"
}
```
**Why Exa?** Strong at academic and technical content

**Why low priority?** Research moves slow, fewer breaking stories

---

## Implementation Example

### New Module: `generate-category-queries.ts`

```typescript
interface CategoryQuerySet {
  category: 'policy' | 'funding' | 'consumer' | 'enterprise' | 'research';
  queries: string[];
  searchEngine: 'firecrawl' | 'exa' | 'tavily';
  dateRange: { daysBack: number };
  priority: 'high' | 'medium' | 'low';
}

export async function generateCategoryQueries(): Promise<CategoryQuerySet[]> {
  const today = new Date().toISOString().substring(0, 10);

  // Use LLM to generate specialized queries for each category
  const prompt = `You are an AI news researcher. Today's date is ${today}.

Generate specialized search queries for each category. Each category has different priorities and target sources.

## Category 1: Policy & Regulation (High Priority)
Target: FDA, EU AI Act, NIST, FTC, government agencies
Generate 5 queries for regulatory announcements, policy changes, enforcement actions

## Category 2: Funding & Acquisitions (High Priority)
Target: TechCrunch, VentureBeat, startup press releases, SEC filings
Generate 5 queries for funding rounds, acquisitions, valuations

## Category 3: Consumer AI Apps (Medium Priority)
Target: Product Hunt, app stores, social media trends
Generate 4 queries for consumer-facing AI apps, viral features

## Category 4: Enterprise B2B AI (Medium Priority)
Target: Business press, enterprise blogs, partnership announcements
Generate 4 queries for enterprise AI deals, partnerships, deployments

## Category 5: Research & Technical (Low Priority)
Target: Arxiv, AI research blogs, technical papers
Generate 4 queries for model releases, benchmarks, techniques

Respond with valid JSON:
{
  "categories": [
    {
      "category": "policy",
      "queries": ["query1", "query2", ...],
      "searchEngine": "exa",
      "daysBack": 14,
      "priority": "high"
    },
    ...
  ]
}`;

  const response = await chatWithMistral({ prompt, maxTokens: 2048 });
  // Parse and validate
  return parsed.categories;
}
```

### Updated Discovery Pipeline

```typescript
// discover.ts - updated to use categories
export async function runDiscovery(existingUrls: Set<string>): Promise<number> {

  // Step 1: Generate category-specific queries
  const categories = await generateCategoryQueries();

  // Step 2: Run searches per category with appropriate engine
  const allResults: SearchResult[] = [];

  for (const cat of categories) {
    let results: SearchResult[];

    // Choose search engine based on category
    switch (cat.searchEngine) {
      case 'exa':
        results = await exaSearch(cat.queries, 3, {
          startPublishedDate: getStartDate(cat.dateRange.daysBack)
        });
        break;
      case 'tavily':
        results = await tavilySearch(cat.queries, 3, {
          startPublishedDate: getStartDate(cat.dateRange.daysBack)
        });
        break;
      default:
        // Fallback to Exa for unknown categories
        results = await exaSearch(cat.queries.join(" "), 5);
    }

    // Tag results with category for downstream processing
    allResults.push(...results.map(r => ({
      ...r,
      category: cat.category,
      priority: cat.priority
    })));
  }

  // Step 3: Process high-priority results first
  const sorted = allResults.sort((a, b) =>
    priorityScore(b.priority) - priorityScore(a.priority)
  );

  // ... rest of pipeline
}
```

---

## Benefits of Category-Specific Queries

### 1. **Deeper Coverage**
- **Before:** 1 generic "AI funding" query → maybe finds TechCrunch headline
- **After:** 5 targeted funding queries → finds Series A/B/C announcements, valuations, acquisition details

### 2. **Appropriate Search Engines**
- **Exa:** Academic papers, regulatory documents, technical specs, semantic search
- **Tavily:** Real-time news, press releases, breaking stories, consumer tech

### 3. **Optimal Timeframes**
- **Policy:** 14-day lookback (slow-moving)
- **Funding:** 5-day lookback (medium speed)
- **Consumer:** 3-day lookback (fast-moving)

### 4. **Priority-Based Processing**
- High-priority categories processed first (policy, funding)
- Ensures critical stories aren't drowned in noise

### 5. **Better Source Attribution**
- Category metadata helps downstream processing know:
  - "This is a policy story, cite government sources"
  - "This is funding news, cite SEC filings and press releases"

---

## Comparison Table

| Aspect | Current Generic Queries | Category-Specific Queries |
|--------|------------------------|--------------------------|
| **Query Count** | 8-12 total | 22 queries across 5 categories |
| **Search Engine** | Exa for all (after Firecrawl removal) | Optimized per category (Exa/Tavily) |
| **Date Range** | Implicit "recent" | Explicit per category (3-14 days) |
| **Priority** | All equal | High/medium/low tiers |
| **Target Sources** | General web | Specific per category (gov, VC, apps, etc.) |
| **Depth** | Surface-level | Deep per category |
| **Source Attribution** | Generic | Category-aware |

---

## Real-World Example

**Current approach** would miss the FDA AI policy story from the AWS newsletter:

```
Generic Query: "AI regulation policy news"
→ Returns: General news articles about AI regulation
→ Misses: Specific FDA announcement with concrete guidelines
```

**Category-specific approach** finds it:

```
Policy Query: "FDA AI medical device approval guidelines 2025"
+ Exa search (optimized for regulatory docs)
+ 14-day lookback (policy moves slow)
→ Returns: FDA press release, official guidelines, impact analysis
→ Story includes: Specific dates, official citations, regulatory details
```

---

## Implementation Steps

1. **Create `generate-category-queries.ts`** - New module for category-specific query generation
2. **Update `discover.ts`** - Use category-based search orchestration
3. **Add search engine routing** - Switch between Exa/Tavily/Firecrawl based on category
4. **Implement priority sorting** - Process high-priority categories first
5. **Add category metadata** - Tag results for downstream processing

---

## Trade-offs

**Pros:**
- Much deeper coverage per topic area
- Better source attribution and authority
- Optimized for different content types
- Prioritizes important stories
- Uses existing free/low-cost tools (Exa, Tavily)

**Cons:**
- More LLM calls (generating queries per category)
- More search API calls (22 queries vs 10)
- Slightly longer pipeline execution
- Need to tune date ranges per category

**Mitigation:**
- Batch query generation into single LLM call
- Run category searches in parallel
- Cache category query templates
- Monitor API costs and adjust concurrency
- **Scraping is already free** (Jina Reader + native fetch)
