# Optional Web Search Providers

Web search grounding is optional and server-side only. The app works normally with search disabled, and local Ollama chat does not require an Ollama account.

## Windows 11 and Microsoft Edge

For a regular Windows 11 setup using the Microsoft Edge PWA, the simplest path is:

1. Leave search disabled until you choose a provider.
2. Add the provider API key as a Windows environment variable.
3. Restart the app so the server process can read the new environment.
4. Choose a Web Search mode in chat settings and select the matching provider.
5. Use **Test provider** to confirm the app can see the required environment variable.

The browser never receives provider API keys. It only calls the local `/api/search` route with the query and provider name.

## Local-only mode

Search is disabled by default:

```shell
SEARCH_PROVIDER=off
```

With search off, chat, model management, RAG memory, and local Ollama usage continue to work offline.

## Off, Manual, and Auto Modes

Web Search has three modes:

- **Off**: never calls `/api/search`.
- **Manual**: searches only when the Web button is enabled for the message.
- **Auto**: checks the prompt with a local deterministic heuristic, then searches only when there is a clear freshness, docs, current-info, provider, error-lookup, GitHub issue, version, price, or external comparison signal.

Auto mode defaults to not searching for local code editing, creative writing, private project planning, simple reasoning, summarizing provided text, and offline/local-only questions. When Auto searches or skips, the chat shows the reason near the assistant response.

When search is used, the app injects a labeled `Web search results` block with visible URLs and tells the model to cite URLs inline only when it uses those results.

Search snippets are treated as untrusted external content in the model prompt. The app filters search result links to `http` and `https`, trims oversized titles/snippets, and tells the model not to follow instructions embedded inside search results.

## Shared settings

```shell
SEARCH_PROVIDER=off
SEARCH_TIMEOUT_MS=10000
SEARCH_RESULT_COUNT=5
SEARCH_SAFE_MODE=true
```

`SEARCH_PROVIDER` can be `off`, `brave`, `tavily`, `exa`, `ollama`, or `custom`. The UI can also send a provider override to `/api/search` when you choose a provider in settings.

## Provider Health Check

The settings UI calls:

```text
GET /api/search/health?provider=<provider>
```

The response reports whether the provider is configured and whether reachability is known:

```json
{
  "provider": "brave",
  "configured": true,
  "reachable": false,
  "error": null
}
```

Health checks are config-only by default to avoid burning provider quota. `reachable: false` with `error: null` means the provider is configured, but reachability was not tested.

## Brave Search API

Brave is the recommended general web-search provider for regular Windows users because it provides JSON results from Brave's independent web index and does not require Docker or WSL. See the [Brave Search API docs](https://brave.com/search/api/).

```shell
SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=your_key_here
```

The server calls Brave Search API and normalizes web results into title, URL, and snippet fields.

## Tavily

Tavily is the best fit when the goal is AI-agent or RAG-focused search results. See the [Tavily Search API docs](https://docs.tavily.com/documentation/api-reference/endpoint/search).

```shell
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your_key_here
```

The app requests concise search results and injects only the top normalized snippets into chat context.

## Exa

Exa is optional for semantic or research-oriented search. See the [Exa Search API docs](https://docs.exa.ai/reference/search).

```shell
SEARCH_PROVIDER=exa
EXA_API_KEY=your_key_here
```

The app uses Exa search results and highlights when available.

## Ollama Hosted Web Search

This is separate from local Ollama chat. It requires an Ollama account/API key for the hosted web search API. See the [Ollama web search docs](https://docs.ollama.com/capabilities/web-search).

```shell
SEARCH_PROVIDER=ollama
OLLAMA_WEB_SEARCH_API_KEY=your_key_here
```

Local chat still runs against your local Ollama instance; only the web search request uses the hosted API.

## Custom Endpoint

Use a custom server-side endpoint when you already have a search service.

```shell
SEARCH_PROVIDER=custom
CUSTOM_SEARCH_ENDPOINT=http://localhost:9000/search
```

The app sends the query as `q=<query>` and accepts either:

```json
{ "results": [] }
```

or:

```json
[]
```

Each result is normalized as best as possible from fields like `title`, `name`, `url`, `link`, `content`, `snippet`, `description`, `source`, `engine`, and `score`.

Custom endpoints must use `http` or `https`. Returned result URLs using other schemes are ignored before they are shown, stored, or injected into chat context.

## Why SearXNG Is Not The Main Windows Path

SearXNG is useful for self-hosted metasearch, but it is not the main recommendation here because regular Windows 11 users often do not use Docker or WSL. Brave and Tavily are easier to enable with a browser, an API key, and environment variables while keeping provider calls server-side and optional.

## Troubleshooting

- **API key missing**: select the provider in settings, click **Test provider**, and confirm the matching environment variable is set before starting the app.
- **Timeout**: increase `SEARCH_TIMEOUT_MS` or check the provider status page/network connection.
- **Provider selected but not configured**: Web Search can stay in Off mode, or choose a provider with a configured key.
- **Packaged build behavior**: packaged/static desktop builds use the Go `/api/search` and `/api/search/health` routes. Next dev/server mode uses the Next App Router routes.
- **Auto mode did not search**: the prompt likely did not contain a freshness, docs, current-info, provider, version, price, or external lookup signal. Use Manual mode when you explicitly want search.
