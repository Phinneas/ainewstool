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
${intro}
${featuredMCPBlock}
---
${sections}
${aiDiscoveriesBlock}${aiForGoodBlock}
---
## The Quick Scribbles

${shortlist}
`;
}
