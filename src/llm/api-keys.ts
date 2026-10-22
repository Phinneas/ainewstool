// Global API keys storage for Worker environment
// Cloudflare Workers share globalThis across all modules
// We declare it on the global scope to ensure all modules see the same instance

declare global {
  var __apiKeys: {
    anthropic: string;
    mistral: string;
    openrouter: string;
    moonshot: string;
    ideogram: string;
    // Not a secret — a plain wrangler var. It lives here because `config` is
    // frozen at module load, which is '' in the Worker, so anything sourced
    // from env at invocation time has to ride this global.
    anthropicModel: string;
  };
}

// Initialize if not already set
if (!globalThis.__apiKeys) {
  globalThis.__apiKeys = {
    anthropic: '',
    mistral: '',
    openrouter: '',
    moonshot: '',
    ideogram: '',
    anthropicModel: '',
  };
}

export const apiKeys = globalThis.__apiKeys;
