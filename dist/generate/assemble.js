export function assembleNewsletter(params) {
    const { subjectLine, preHeaderText, intro, storySections, shortlist } = params;
    const sections = storySections.join("\n\n---\n");
    return `# ${subjectLine}

${preHeaderText}

---
${intro}

---
${sections}

---
## The Quick Scribbles

${shortlist}
`;
}
