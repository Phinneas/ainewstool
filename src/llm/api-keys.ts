// Global API keys storage for Worker environment
// Cloudflare Workers share globalThis across all modules
// We declare it on the global scope to ensure all modules see the same instance

declare global {
  var __apiKeys: {
    anthropic: string;
    mistral: string;
    moonshot: string;
  };
}

// Initialize if not already set
if (!globalThis.__apiKeys) {
  globalThis.__apiKeys = {
    anthropic: '',
    mistral: '',
    moonshot: '',
  };
}

export const apiKeys = globalThis.__apiKeys;
