export function assembleNewsletter(params) {
    const { subjectLine, preHeaderText, intro, storySections, shortlist, featuredMCP, aiDiscoveries, aiForGood } = params;
    const sections = storySections.join("\n\n---\n");
    const featuredMCPBlock = featuredMCP ? `\n---\n${featuredMCP}\n` : "";
    const aiDiscoveriesBlock = aiDiscoveries ? `\n---\n${aiDiscoveries}\n` : "";
    const aiForGoodBlock = aiForGood ? `\n---\n${aiForGood}\n` : "";
    const newsletterRecommendations = `
---

## Worth Your Inbox

Discover more quality AI and tech content:

- **[SemiVision](https://tspasemiconductor.substack.com/?r=ykyfl&utm_campaign=referrals-subscribe-page-share-screen&utm_medium=web)** — Semiconductor industry insights and AI chip developments
- **[Turing Post](https://www.turingpost.com/subscribe?ref=UkXVFz6Kl3)** — Deep technical analysis of AI research and breakthroughs
- **[FinOps Weekly](https://newsletter.finopsweekly.com/subscribe?ref=UkXVFz6Kl3)** — Cloud cost optimization and financial operations
- **[CoreUpdates](https://sparklp.co/d865babd/)** — Essential tech updates and startup intelligence
- **[The Multiverse School](https://themultiverseschool.substack.com?r=ykyfl)** — Learning and development in the AI era
- **[Simple AWS](https://newsletter.simpleaws.dev/subscribe?ref=UkXVFz6Kl3)** — Practical AWS tutorials and cloud architecture
- **[EarthConscious](https://earthconsciouslife.org/subscribe?ref=24gXUoAEbr)** — Sustainable living and environmental consciousness`;
    const partnershipSection = `

---

## Partner Spotlight

Support BrainScriblr while discovering powerful AI tools (affiliate links):

- **[n8n](https://n8n.partnerlinks.io/kp8zws0d8gpb)** — No-code automation platform for AI workflows
- **[Hume AI](https://try.hume.ai/zgasnk9snm1s)** — Emotional intelligence API for human-centered AI
- **[Railway](https://railway.com?referralCode=6EFc41)** — Cloud platform for deploying AI applications
- **[Cudo Compute](https://www.cudocompute.com/?via=chester)** — Distributed cloud computing for AI workloads`;
    return `# ${subjectLine}

${preHeaderText}

---
## Quick Scribbles

${shortlist}

---

**Stay Connected**

[Subscribe to BrainScriblr](https://magic.beehiiv.com/v1/ed1015eb-afed-4a1b-8adf-68e3cda41ac7?email={{email}}) for the latest AI developments delivered to your inbox.

---
${intro}
${featuredMCPBlock}
---
${sections}
${aiDiscoveriesBlock}${aiForGoodBlock}${partnershipSection}
${newsletterRecommendations}`;
}
