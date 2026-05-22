/* Do not change, this code is generated from Golang structs */


export class ChatInfo {
    id: string;
    title: string;
    userExcerpt: string;
    createdAt: Date;
    updatedAt: Date;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.title = source["title"];
        this.userExcerpt = source["userExcerpt"];
        this.createdAt = new Date(source["createdAt"]);
        this.updatedAt = new Date(source["updatedAt"]);
    }
}
export class ChatsResponse {
    chatInfos: ChatInfo[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.chatInfos = this.convertValues(source["chatInfos"], ChatInfo);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Time {


    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);

    }
}
export class MessageSearchResult {
    title: string;
    url: string;
    content: string;
    source?: string;
    engine?: string;
    score?: number;
    publishedDate?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.title = source["title"];
        this.url = source["url"];
        this.content = source["content"];
        this.source = source["source"];
        this.engine = source["engine"];
        this.score = source["score"];
        this.publishedDate = source["publishedDate"];
    }
}
export class ContextWarning {
    kind: string;
    message: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.kind = source["kind"];
        this.message = source["message"];
    }
}
export class ContextMessageDetail {
    role: string;
    content: string;
    source?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.role = source["role"];
        this.content = source["content"];
        this.source = source["source"];
    }
}
export class ContextNotice {
    mode: string;
    action: string;
    omittedMessageCount?: number;
    estimatedOmittedTokens?: number;
    retrievedMemoryCount?: number;
    estimatedRetrievedTokens?: number;
    retrievedMessages?: ContextMessageDetail[];
    summary?: string;
    expertMode?: boolean;
    estimatedPromptTokensBefore?: number;
    estimatedPromptTokensAfter?: number;
    outputReserveTokens?: number;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.mode = source["mode"];
        this.action = source["action"];
        this.omittedMessageCount = source["omittedMessageCount"];
        this.estimatedOmittedTokens = source["estimatedOmittedTokens"];
        this.retrievedMemoryCount = source["retrievedMemoryCount"];
        this.estimatedRetrievedTokens = source["estimatedRetrievedTokens"];
        this.retrievedMessages = this.convertValues(source["retrievedMessages"], ContextMessageDetail);
        this.summary = source["summary"];
        this.expertMode = source["expertMode"];
        this.estimatedPromptTokensBefore = source["estimatedPromptTokensBefore"];
        this.estimatedPromptTokensAfter = source["estimatedPromptTokensAfter"];
        this.outputReserveTokens = source["outputReserveTokens"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class OllamaUsageMetrics {
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
    done_reason?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.total_duration = source["total_duration"];
        this.load_duration = source["load_duration"];
        this.prompt_eval_count = source["prompt_eval_count"];
        this.prompt_eval_duration = source["prompt_eval_duration"];
        this.eval_count = source["eval_count"];
        this.eval_duration = source["eval_duration"];
        this.done_reason = source["done_reason"];
    }
}
export class ResponseStats {
    outputTokens?: number;
    promptTokens?: number;
    contextUsed?: number;
    contextLimit?: number;
    contextPercent?: number;
    outputTokensPerSecond?: number;
    promptTokensPerSecond?: number;
    totalSeconds?: number;
    loadSeconds?: number;
    doneReason?: string;
    raw?: OllamaUsageMetrics;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.outputTokens = source["outputTokens"];
        this.promptTokens = source["promptTokens"];
        this.contextUsed = source["contextUsed"];
        this.contextLimit = source["contextLimit"];
        this.contextPercent = source["contextPercent"];
        this.outputTokensPerSecond = source["outputTokensPerSecond"];
        this.promptTokensPerSecond = source["promptTokensPerSecond"];
        this.totalSeconds = source["totalSeconds"];
        this.loadSeconds = source["loadSeconds"];
        this.doneReason = source["doneReason"];
        this.raw = this.convertValues(source["raw"], OllamaUsageMetrics);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class ToolFunction {
    name: string;
    arguments: string;
    result?: any;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.name = source["name"];
        this.arguments = source["arguments"];
        this.result = source["result"];
    }
}
export class ToolCall {
    type: string;
    function: ToolFunction;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.type = source["type"];
        this.function = this.convertValues(source["function"], ToolFunction);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class File {
    filename: string;
    data: number[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.filename = source["filename"];
        this.data = source["data"];
    }
}
export class Message {
    role: string;
    content: string;
    thinking: string;
    stream: boolean;
    model?: string;
    attachments?: File[];
    tool_calls?: ToolCall[];
    tool_call?: ToolCall;
    tool_name?: string;
    tool_result?: number[];
    stats?: ResponseStats;
    contextNotice?: ContextNotice;
    contextWarnings?: ContextWarning[];
    webSearchMode?: string;
    webSearchProvider?: string;
    webSearchResults?: MessageSearchResult[];
    webSearchError?: string;
    webSearchReason?: string;
    webSearchSearched?: boolean;
    created_at: Time;
    updated_at: Time;
    thinkingTimeStart?: Date | undefined;
    thinkingTimeEnd?: Date | undefined;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.role = source["role"];
        this.content = source["content"];
        this.thinking = source["thinking"];
        this.stream = source["stream"];
        this.model = source["model"];
        this.attachments = this.convertValues(source["attachments"], File);
        this.tool_calls = this.convertValues(source["tool_calls"], ToolCall);
        this.tool_call = this.convertValues(source["tool_call"], ToolCall);
        this.tool_name = source["tool_name"];
        this.tool_result = source["tool_result"];
        this.stats = this.convertValues(source["stats"], ResponseStats);
        this.contextNotice = this.convertValues(source["contextNotice"], ContextNotice);
        this.contextWarnings = this.convertValues(source["contextWarnings"], ContextWarning);
        this.webSearchMode = source["webSearchMode"];
        this.webSearchProvider = source["webSearchProvider"];
        this.webSearchResults = this.convertValues(source["webSearchResults"], MessageSearchResult);
        this.webSearchError = source["webSearchError"];
        this.webSearchReason = source["webSearchReason"];
        this.webSearchSearched = source["webSearchSearched"];
        this.created_at = this.convertValues(source["created_at"], Time);
        this.updated_at = this.convertValues(source["updated_at"], Time);
        this.thinkingTimeStart = source["thinkingTimeStart"] && new Date(source["thinkingTimeStart"]);
        this.thinkingTimeEnd = source["thinkingTimeEnd"] && new Date(source["thinkingTimeEnd"]);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Chat {
    id: string;
    messages: Message[];
    title: string;
    created_at: Time;
    browser_state?: BrowserStateData;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.messages = this.convertValues(source["messages"], Message);
        this.title = source["title"];
        this.created_at = this.convertValues(source["created_at"], Time);
        this.browser_state = source["browser_state"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class ChatResponse {
    chat: Chat;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.chat = this.convertValues(source["chat"], Chat);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Model {
    model: string;
    digest?: string;
    modified_at?: Time;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.model = source["model"];
        this.digest = source["digest"];
        this.modified_at = this.convertValues(source["modified_at"], Time);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class ModelsResponse {
    models: Model[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.models = this.convertValues(source["models"], Model);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class InferenceCompute {
    library: string;
    variant: string;
    compute: string;
    driver: string;
    name: string;
    vram: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.library = source["library"];
        this.variant = source["variant"];
        this.compute = source["compute"];
        this.driver = source["driver"];
        this.name = source["name"];
        this.vram = source["vram"];
    }
}
export class InferenceComputeResponse {
    inferenceComputes: InferenceCompute[];
    defaultContextLength: number;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.inferenceComputes = this.convertValues(source["inferenceComputes"], InferenceCompute);
        this.defaultContextLength = source["defaultContextLength"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class ModelCapabilitiesResponse {
    capabilities: string[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.capabilities = source["capabilities"];
    }
}
export class ChatEventAttachment {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    kind: string;
    data?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.mimeType = source["mimeType"];
        this.size = source["size"];
        this.kind = source["kind"];
        this.data = source["data"];
    }
}
export class ChatEvent {
    eventName: "chat" | "thinking" | "assistant_with_tools" | "tool_call" | "tool" | "tool_result" | "done" | "chat_created";
    content?: string;
    thinking?: string;
    attachments?: ChatEventAttachment[];
    thinkingTimeStart?: Date | undefined;
    thinkingTimeEnd?: Date | undefined;
    stats?: ResponseStats;
    contextNotice?: ContextNotice;
    contextWarnings?: ContextWarning[];
    toolCalls?: ToolCall[];
    toolCall?: ToolCall;
    toolName?: string;
    toolResult?: boolean;
    toolResultData?: any;
    chatId?: string;
    toolState?: any;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.eventName = source["eventName"];
        this.content = source["content"];
        this.thinking = source["thinking"];
        this.attachments = this.convertValues(source["attachments"], ChatEventAttachment);
        this.thinkingTimeStart = source["thinkingTimeStart"] && new Date(source["thinkingTimeStart"]);
        this.thinkingTimeEnd = source["thinkingTimeEnd"] && new Date(source["thinkingTimeEnd"]);
        this.stats = this.convertValues(source["stats"], ResponseStats);
        this.contextNotice = this.convertValues(source["contextNotice"], ContextNotice);
        this.contextWarnings = this.convertValues(source["contextWarnings"], ContextWarning);
        this.toolCalls = this.convertValues(source["toolCalls"], ToolCall);
        this.toolCall = this.convertValues(source["toolCall"], ToolCall);
        this.toolName = source["toolName"];
        this.toolResult = source["toolResult"];
        this.toolResultData = source["toolResultData"];
        this.chatId = source["chatId"];
        this.toolState = source["toolState"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}

export class DownloadEvent {
    eventName: "download";
    total: number;
    completed: number;
    done: boolean;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.eventName = source["eventName"];
        this.total = source["total"];
        this.completed = source["completed"];
        this.done = source["done"];
    }
}
export class ErrorEvent {
    eventName: "error";
    error: string;
    code?: string;
    details?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.eventName = source["eventName"];
        this.error = source["error"];
        this.code = source["code"];
        this.details = source["details"];
    }
}
export class Settings {
    Expose: boolean;
    Browser: boolean;
    Survey: boolean;
    Models: string;
    Agent: boolean;
    Tools: boolean;
    WorkingDir: string;
    ContextLength: number;
    TurboEnabled: boolean;
    WebSearchEnabled: boolean;
    ThinkEnabled: boolean;
    ThinkLevel: string;
    SelectedModel: string;
    SidebarOpen: boolean;
    LastHomeView: string;
    AutoUpdateEnabled: boolean;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.Expose = source["Expose"];
        this.Browser = source["Browser"];
        this.Survey = source["Survey"];
        this.Models = source["Models"];
        this.Agent = source["Agent"];
        this.Tools = source["Tools"];
        this.WorkingDir = source["WorkingDir"];
        this.ContextLength = source["ContextLength"];
        this.TurboEnabled = source["TurboEnabled"];
        this.WebSearchEnabled = source["WebSearchEnabled"];
        this.ThinkEnabled = source["ThinkEnabled"];
        this.ThinkLevel = source["ThinkLevel"];
        this.SelectedModel = source["SelectedModel"];
        this.SidebarOpen = source["SidebarOpen"];
        this.LastHomeView = source["LastHomeView"];
        this.AutoUpdateEnabled = source["AutoUpdateEnabled"];
    }
}
export class SettingsResponse {
    settings: Settings;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.settings = this.convertValues(source["settings"], Settings);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class AppDataResetResponse {
    backupPaths: string[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.backupPaths = source["backupPaths"];
    }
}
export class SecurityWarning {
    code: string;
    message: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.code = source["code"];
        this.message = source["message"];
    }
}
export class SecurityStatusResponse {
    mode: "desktop";
    coreApiBase: string;
    coreApiReachable: boolean;
    coreApiHostLocal: boolean;
    coreApiHostAllowed: boolean;
    coreApiAuthEnabled: boolean;
    desktopAuthEnabled: boolean;
    devMode: boolean;
    localOnlyOfflineMode: boolean;
    cloudDisabled: boolean;
    cloudSource: "env" | "config" | "both" | "none";
    appDataEncrypted: boolean;
    appDataEncryptionState: "plain" | "enabled" | "encrypted" | "legacy_encrypted" | "key_missing" | "key_invalid" | "unknown";
    appDataEncryptionKeySet: boolean;
    appDataEncryptionDisabled: boolean;
    appDataEncryptionLegacy: boolean;
    appDataEncryptionError?: string;
    networkExposureAllowed: boolean;
    modelMutationProxyEnabled: boolean;
    pushProxyEnabled: boolean;
    browserOriginsEnabled: boolean;
    customBrowserOrigins: boolean;
    proxyAllowedUpstreams: string[];
    warnings: SecurityWarning[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.mode = source["mode"];
        this.coreApiBase = source["coreApiBase"];
        this.coreApiReachable = source["coreApiReachable"];
        this.coreApiHostLocal = source["coreApiHostLocal"];
        this.coreApiHostAllowed = source["coreApiHostAllowed"];
        this.coreApiAuthEnabled = source["coreApiAuthEnabled"];
        this.desktopAuthEnabled = source["desktopAuthEnabled"];
        this.devMode = source["devMode"];
        this.localOnlyOfflineMode = source["localOnlyOfflineMode"];
        this.cloudDisabled = source["cloudDisabled"];
        this.cloudSource = source["cloudSource"];
        this.appDataEncrypted = source["appDataEncrypted"];
        this.appDataEncryptionState = source["appDataEncryptionState"];
        this.appDataEncryptionKeySet = source["appDataEncryptionKeySet"];
        this.appDataEncryptionDisabled = source["appDataEncryptionDisabled"];
        this.appDataEncryptionLegacy = source["appDataEncryptionLegacy"];
        this.appDataEncryptionError = source["appDataEncryptionError"];
        this.networkExposureAllowed = source["networkExposureAllowed"];
        this.modelMutationProxyEnabled = source["modelMutationProxyEnabled"];
        this.pushProxyEnabled = source["pushProxyEnabled"];
        this.browserOriginsEnabled = source["browserOriginsEnabled"];
        this.customBrowserOrigins = source["customBrowserOrigins"];
        this.proxyAllowedUpstreams = source["proxyAllowedUpstreams"];
        this.warnings = this.convertValues(source["warnings"], SecurityWarning);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class HealthResponse {
    healthy: boolean;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.healthy = source["healthy"];
    }
}
export class User {
    id: string;
    email: string;
    name: string;
    bio?: string;
    avatarurl?: string;
    firstname?: string;
    lastname?: string;
    plan?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.email = source["email"];
        this.name = source["name"];
        this.bio = source["bio"];
        this.avatarurl = source["avatarurl"];
        this.firstname = source["firstname"];
        this.lastname = source["lastname"];
        this.plan = source["plan"];
    }
}
export class Attachment {
    filename: string;
    data?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.filename = source["filename"];
        this.data = source["data"];
    }
}
export class SearchResult {
    title: string;
    url: string;
    content: string;
    source?: string;
    engine?: string;
    score?: number;
    publishedDate?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.title = source["title"];
        this.url = source["url"];
        this.content = source["content"];
        this.source = source["source"];
        this.engine = source["engine"];
        this.score = source["score"];
        this.publishedDate = source["publishedDate"];
    }
}
export class ChatRequest {
    model: string;
    prompt: string;
    index?: number;
    attachments?: Attachment[];
    width?: number;
    height?: number;
    steps?: number;
    web_search?: boolean;
    file_tools?: boolean;
    forceUpdate?: boolean;
    think?: any;
    contextMode?: string;
    numCtx?: number;
    numPredict?: number;
    reserveOutputTokens?: number;
    nearFullThresholdPercent?: number;
    enableAutoTrim?: boolean;
    enableAutoSummarize?: boolean;
    enableRetrieval?: boolean;
    retrievalScope?: string;
    retrievalChatIds?: string[];
    retrievalExcludedChatIds?: string[];
    retrievalLimit?: number;
    expertMode?: boolean;
    expertInstructions?: string;
    webSearchContext?: string;
    webSearchMode?: string;
    webSearchProvider?: string;
    webSearchResults?: SearchResult[];
    webSearchError?: string;
    webSearchReason?: string;
    webSearchSearched?: boolean;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.model = source["model"];
        this.prompt = source["prompt"];
        this.index = source["index"];
        this.attachments = this.convertValues(source["attachments"], Attachment);
        this.width = source["width"];
        this.height = source["height"];
        this.steps = source["steps"];
        this.web_search = source["web_search"];
        this.file_tools = source["file_tools"];
        this.forceUpdate = source["forceUpdate"];
        this.think = source["think"];
        this.contextMode = source["contextMode"];
        this.numCtx = source["numCtx"];
        this.numPredict = source["numPredict"];
        this.reserveOutputTokens = source["reserveOutputTokens"];
        this.nearFullThresholdPercent = source["nearFullThresholdPercent"];
        this.enableAutoTrim = source["enableAutoTrim"];
        this.enableAutoSummarize = source["enableAutoSummarize"];
        this.enableRetrieval = source["enableRetrieval"];
        this.retrievalScope = source["retrievalScope"];
        this.retrievalChatIds = source["retrievalChatIds"];
        this.retrievalExcludedChatIds = source["retrievalExcludedChatIds"];
        this.retrievalLimit = source["retrievalLimit"];
        this.expertMode = source["expertMode"];
        this.expertInstructions = source["expertInstructions"];
        this.webSearchContext = source["webSearchContext"];
        this.webSearchMode = source["webSearchMode"];
        this.webSearchProvider = source["webSearchProvider"];
        this.webSearchResults = this.convertValues(source["webSearchResults"], SearchResult);
        this.webSearchError = source["webSearchError"];
        this.webSearchReason = source["webSearchReason"];
        this.webSearchSearched = source["webSearchSearched"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}

export class SearchResponse {
    provider: string;
    query: string;
    disabled: boolean;
    results: SearchResult[];
    message?: string;
    error?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.provider = source["provider"];
        this.query = source["query"];
        this.disabled = source["disabled"];
        this.results = this.convertValues(source["results"], SearchResult);
        this.message = source["message"];
        this.error = source["error"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class SearchHealthResponse {
    provider: string;
    configured: boolean;
    reachable: boolean;
    error?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.provider = source["provider"];
        this.configured = source["configured"];
        this.reachable = source["reachable"];
        this.error = source["error"];
    }
}
export class Error {
    error: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.error = source["error"];
    }
}
export class ModelUpstreamResponse {
    stale: boolean;
    error?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.stale = source["stale"];
        this.error = source["error"];
    }
}
export class Page {
    url: string;
    title: string;
    text: string;
    lines: string[];
    links?: Record<number, string>;
    fetched_at: Time;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.url = source["url"];
        this.title = source["title"];
        this.text = source["text"];
        this.lines = source["lines"];
        this.links = source["links"];
        this.fetched_at = this.convertValues(source["fetched_at"], Time);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class BrowserStateData {
    page_stack: string[];
    view_tokens: number;
    url_to_page: {[key: string]: Page};

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.page_stack = source["page_stack"];
        this.view_tokens = source["view_tokens"];
        this.url_to_page = source["url_to_page"];
    }
}
