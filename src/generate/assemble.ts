export function assembleNewsletter(params: {
  subjectLine: string;
  preHeaderText: string;
  intro: string;
  storySections: string[];
  shortlist: string;
}): string {
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
