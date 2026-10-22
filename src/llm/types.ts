// Reasoning-effort levels accepted by `output_config.effort` on Claude models
// with adaptive thinking (Sonnet 5.5 and later). Not supported on Sonnet 4.5
// and earlier — passing it there is rejected by the API.
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'max';

export interface LLMClient {
  chat(params: {
    system?: string;
    prompt: string;
    maxTokens?: number;
    model?: string;
    effort?: ClaudeEffort;
  }): Promise<string>;
}
