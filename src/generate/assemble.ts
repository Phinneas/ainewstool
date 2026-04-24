export function assembleNewsletter(params: {
  subjectLine: string;
  preHeaderText: string;
  intro: string;
  storySections: string[];
  shortlist: string;
  featuredMCP?: string;
  aiDiscoveries?: string;
  aiForGood?: string;
}): string {
  const { subjectLine, preHeaderText, intro, storySections, shortlist, featuredMCP, aiDiscoveries, aiForGood } = params;

  const sections = storySections.join("\n\n---\n");
  const featuredMCPBlock = featuredMCP ? `\n---\n${featuredMCP}\n` : "";
  const aiDiscoveriesBlock = aiDiscoveries ? `\n---\n${aiDiscoveries}\n` : "";
  const aiForGoodBlock = aiForGood ? `\n---\n${aiForGood}\n` : "";

  return `# ${subjectLine}

${preHeaderText}

---
## Quick Scribbles

${shortlist}
---
${intro}
${featuredMCPBlock}
---
${sections}
${aiDiscoveriesBlock}${aiForGoodBlock}

---

**Stay Connected**

[Subscribe to AI Newsletter](https://magic.beehiiv.com/v1/ed1015eb-afed-4a1b-8adf-68e3cda41ac7?email={{email}}) for the latest AI developments delivered to your inbox.`;
}
