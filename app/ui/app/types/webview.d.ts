export {};

interface WebviewFile {
  filename: string;
  path: string;
  dataURL: string;
}

interface WebviewAPI {
  selectModelsDirectory?: () => Promise<string | null>;
  selectWorkingDirectory?: () => Promise<string | null>;
  selectFile?: () => Promise<WebviewFile | null>;
  selectMultipleFiles?: () => Promise<WebviewFile[] | null>;
}

declare global {
  interface Window {
    webview?: WebviewAPI;
    selectModelsDirectory?: () => Promise<unknown>;
    selectWorkingDirectory?: () => Promise<unknown>;
    __selectModelsDirectoryCallback?: (directory: string | null) => void;
    __selectWorkingDirectoryCallback?: (directory: string | null) => void;
    drag?: () => void;
    doubleClick?: () => void;
    ready?: () => Promise<void> | void;
    OLLAMA_DESKTOP?: boolean;
    OLLAMA_TOOLS?: boolean;
    OLLAMA_WEBSEARCH?: boolean;
  }
}
