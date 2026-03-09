export function assembleNewsletter(params) {
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
${aiDiscoveriesBlock}${aiForGoodBlock}`;
}
