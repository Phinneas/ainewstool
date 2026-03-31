export interface LLMClient {
  chat(params: {
    system?: string;
    prompt: string;
    maxTokens?: number;
    model?: string;
  }): Promise<string>;
}
