# OpenAI's new reasoning model family arrives

PLUS: Google's Gemini gets real-time web access, Anthropic's enterprise push, and NVIDIA's robotics breakthrough

---
**Good morning, {{first_name | AI enthusiast}}.** OpenAI just dropped its latest reasoning model family, o4-mini and o4, promising faster and more cost-effective performance across coding, math, and multi-step tasks.

With benchmark scores that edge past previous leaders and a new "structured reasoning" mode aimed at developers, this could reshape how teams build AI-powered applications in 2026.

**In today's BrainScriblr:**

- OpenAI launches o4 reasoning model family
- Google gives Gemini real-time web browsing
- Anthropic targets enterprise with new Teams tier
- NVIDIA demos humanoid robot breakthroughs

---
# OpenAI Launches the o4 Reasoning Model Family

**The Scoop:** OpenAI released [o4-mini and o4](https://openai.com/blog/o4-reasoning-models), its next-generation reasoning models designed for complex multi-step tasks. The models deliver **40% faster** responses and **60% lower costs** compared to the o3 family.

**Unpacked:**

- The new **structured reasoning mode** lets developers constrain the model's chain-of-thought to specific output formats, making it significantly easier to [build reliable AI pipelines](https://openai.com/docs/structured-reasoning).
- o4-mini scores **92.7% on GPQA Diamond** and **96.4% on MATH-500**, placing it ahead of competing models at a fraction of the compute cost.
- Both models are available today through the API with a **128K context window** and native tool-use support, while ChatGPT Plus users get o4-mini access immediately.

**Bottom line:** The o4 family narrows the gap between raw reasoning power and practical deployment costs. Developers now have fewer excuses not to ship reasoning-heavy features into production.

---
# Google Gives Gemini Real-Time Web Browsing

**The Scoop:** Google announced that [Gemini 2.5 Pro](https://blog.google/products/gemini/gemini-web-browsing/) now has real-time web browsing capabilities, allowing it to search, read, and synthesize information from live web pages directly within conversations.

**Unpacked:**

- Unlike previous implementations, Gemini's browsing uses a **multi-step verification pipeline** that cross-references claims across sources before presenting answers, reducing hallucination rates by [an estimated 35%](https://blog.google/technology/ai/gemini-browsing-accuracy/).
- The feature is rolling out to **Gemini Advanced subscribers** first, with API access expected within weeks for developers building search-augmented applications.
- Google positioned this as a direct response to ChatGPT's browsing and Perplexity's search capabilities, emphasizing Gemini's tighter integration with **Google Search infrastructure**.

**Bottom line:** Real-time web access turns Gemini from a knowledge-cutoff chatbot into a live research assistant. The accuracy-first approach could set a new standard for grounded AI responses.

---
# Anthropic Targets Enterprise With New Teams Tier

**The Scoop:** Anthropic launched [Claude for Teams](https://www.anthropic.com/news/claude-teams), a new enterprise-focused plan offering **500K context windows**, admin controls, and SOC 2 compliance baked into a $30/user/month package.

**Unpacked:**

- The Teams tier includes **centralized billing, SSO, and usage dashboards** designed for organizations with 5-500 employees that don't need the full custom deployment of Claude Enterprise.
- A new **Projects feature** lets teams create shared prompt libraries and document collections that persist across conversations, streamlining [collaborative workflows](https://docs.anthropic.com/claude/projects).
- Anthropic reported that Claude's enterprise revenue grew **4x in the last quarter**, driven by adoption in legal, financial services, and software development teams.

**Bottom line:** Anthropic is filling the gap between individual Claude Pro subscriptions and six-figure enterprise deals. The pricing puts direct pressure on OpenAI's Team plan and Microsoft's Copilot for Business.

---
# NVIDIA Demos Humanoid Robot Breakthroughs at GTC

**The Scoop:** At GTC 2026, NVIDIA showcased [Project GR00T 2.0](https://nvidianews.nvidia.com/news/groot-2-humanoid-robots), its updated foundation model for humanoid robots, demonstrating robots that can learn complex manipulation tasks from just a few human demonstrations.

**Unpacked:**

- The updated GR00T model uses a **sim-to-real transfer pipeline** built on NVIDIA's Isaac Lab, cutting the time to train a new robot skill from weeks to **under 48 hours**.
- NVIDIA announced partnerships with **Figure, Apptronik, and 1X Technologies** to deploy GR00T-powered robots in warehouse and manufacturing settings starting Q3 2026.
- A new **Isaac Perceptor module** gives robots real-time 3D scene understanding using multiple camera feeds, enabling them to [navigate dynamic environments](https://developer.nvidia.com/isaac-perceptor) without pre-mapped layouts.

**Bottom line:** NVIDIA is positioning itself as the operating system layer for humanoid robotics. As hardware costs drop, the software stack becomes the real competitive moat.

---
## The Quick Scribbles

**Mistral** [released](https://mistral.ai/news/mistral-medium-3) Mistral Medium 3, a 70B parameter model optimized for enterprise RAG workloads that matches GPT-4o performance at one-third the inference cost.

**Apple** [unveiled](https://machinelearning.apple.com/research/on-device-llm) a new on-device LLM framework for iOS 20 that runs 7B parameter models natively on iPhone 17 Pro, enabling offline AI features without cloud dependency.

**Hugging Face** [launched](https://huggingface.co/blog/open-reasoning-leaderboard) an Open Reasoning Leaderboard tracking model performance on multi-step logical tasks, giving researchers a standardized benchmark for evaluating chain-of-thought capabilities.

**Runway** [introduced](https://runwayml.com/research/gen-4) Gen-4, its latest video generation model that produces 30-second clips with consistent character identity and improved physics simulation across frames.
