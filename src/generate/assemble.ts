export function assembleNewsletter(params: {
  subjectLine: string;
  preHeaderText: string;
  intro: string;
  storySections: string[];
  shortlist: string;
  featuredMCP?: string; // Pre-formatted markdown section from formatFeaturedMCPSection()
}): string {
  const { subjectLine, preHeaderText, intro, storySections, shortlist, featuredMCP } = params;

  const sections = storySections.join("\n\n---\n");
  const featuredMCPBlock = featuredMCP ? `\n---\n${featuredMCP}\n` : "";

  return `# ${subjectLine}

${preHeaderText}

---
${intro}
${featuredMCPBlock}
---
${sections}

---
## The Quick Scribbles

${shortlist}
`;
}
