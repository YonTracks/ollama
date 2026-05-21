# Security

The Ollama maintainer team takes security seriously and will actively work to resolve security issues.

## Reporting a vulnerability

If you discover a security vulnerability, please do not open a public issue. Instead, please report it by emailing hello@ollama.com. We ask that you give us sufficient time to investigate and address the vulnerability before disclosing it publicly.

Please include the following details in your report:
- A description of the vulnerability
- Steps to reproduce the issue
- Your assessment of the potential impact
- Any possible mitigations

## Security best practices

While the maintainer team does its best to secure Ollama, users are encouraged to implement their own security best practices, such as:

- Regularly updating to the latest version of Ollama
- Securing access to hosted instances of Ollama
- Monitoring systems for unusual activity

## Backend security

Ollama's local API is safest when bound to localhost. Keep `ollama serve` bound
to localhost, and do not expose port `11434` directly to a LAN or the internet
unless you have explicitly enabled and tested authentication or a hardened
proxy.

- Use `OLLAMA_HOST=127.0.0.1:11434` for local serving.
- `ollama serve` refuses non-localhost bind addresses unless
  `OLLAMA_ALLOW_NETWORK_EXPOSURE=true` is also set.
- Set `OLLAMA_API_TOKEN` to require `Authorization: Bearer <token>` on the core
  HTTP API. The Ollama CLI will send this token automatically when the same
  environment variable is set for the CLI process.
- The Ollama CLI remains local by default and talks to the local `ollama serve`
  process.
- For LAN or remote access, expose only an authenticated proxy or authenticated
  app endpoint in front of Ollama.
- On Windows, use firewall rules to block inbound access to `11434` unless you
  have intentionally configured and secured a proxy path.

The desktop app proxy only connects to localhost upstreams by default:
`127.0.0.1`, `localhost`, and `::1`. Override the host allowlist with
`OLLAMA_PROXY_ALLOWED_UPSTREAMS`, but keep it limited to loopback hosts.

The authenticated proxy blocks model-changing routes by default. Set
`OLLAMA_PROXY_ALLOW_MODEL_MUTATION=true` to allow `/api/pull`, `/api/create`,
`/api/copy`, `/api/delete`, and model blob uploads through the proxy. Set
`OLLAMA_PROXY_ALLOW_PUSH=true` separately to allow `/api/push`. Proxy routes use
request body limits and logs avoid request bodies, tokens, API keys, and query
strings.

Custom web search endpoints are treated as outbound network targets. By default
the app rejects `CUSTOM_SEARCH_ENDPOINT` values that point at localhost,
private, link-local, multicast, or single-label hosts. Set
`CUSTOM_SEARCH_ALLOW_LOCAL=true` only when the endpoint is a trusted local search
adapter that you control.

The desktop app exposes a non-secret security status endpoint at
`/api/v1/security` and a matching Settings section. It reports whether the core
API is reachable, whether the proxy upstream is localhost-only, whether desktop
auth is active, whether network exposure or model-mutation proxy flags are
enabled, and any warnings. It does not include tokens, cookies, API keys,
prompts, or request bodies.

The Windows installer sets `OLLAMA_HOST=127.0.0.1:11434` only when the user does
not already have `OLLAMA_HOST` configured. It runs without elevation, so it does
not create firewall rules. Use Windows Firewall or equivalent endpoint policy to
block inbound access to `11434` if your environment requires an explicit rule.

## Contact

For any other questions or concerns related to security, please contact us at hello@ollama.com
