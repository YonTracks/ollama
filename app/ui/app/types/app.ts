export type ConnectionStatus = "checking" | "connected" | "disconnected" | "offline";

export type ContextManagementMode = "strict" | "friendly";
export type RetrievalMemoryScope = "current" | "selected" | "all";
export type WebSearchProvider = "off" | "brave" | "tavily" | "exa" | "ollama" | "custom";
export type WebSearchMode = "off" | "manual" | "auto";

export interface LocalSettings {
  selectedModel: string;
  coreApiBase: string;
  coreApiToken: string;
  sidebarOpen: boolean;
  expose: boolean;
  browser: boolean;
  models: string;
  agent: boolean;
  tools: boolean;
  workingDir: string;
  contextLength: number;
  maxOutputTokens: number;
  contextMode: ContextManagementMode;
  reserveOutputTokens: number;
  nearFullThresholdPercent: number;
  enableAutoTrim: boolean;
  enableAutoSummarize: boolean;
  enableRetrieval: boolean;
  retrievalScope: RetrievalMemoryScope;
  retrievalChatIds: string[];
  retrievalExcludedChatIds: string[];
  contextDefaultsVersion?: number;
  retrievalLimit: number;
  expertMode: boolean;
  expertInstructions: string;
  webSearchMode: WebSearchMode;
  webSearchEnabled: boolean;
  webSearchProvider: WebSearchProvider;
  thinkEnabled: boolean;
  thinkLevel: "none" | "low" | "medium" | "high";
  autoUpdateEnabled: boolean;
  compactMessages: boolean;
  imageGenerationWidth: number;
  imageGenerationHeight: number;
  imageGenerationSteps: number;
}

export interface InstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface ServiceWorkerState {
  supported: boolean;
  registered: boolean;
  installing: boolean;
  updateReady: boolean;
  error: string | null;
}
