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

Ollama's local API does not provide built-in authentication. Keep `ollama serve`
bound to localhost, and do not expose port `11434` directly to a LAN or the
internet.

- Use `OLLAMA_HOST=127.0.0.1:11434` for local serving.
- `ollama serve` refuses non-localhost bind addresses unless
  `OLLAMA_ALLOW_NETWORK_EXPOSURE=true` is also set.
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

## Contact

For any other questions or concerns related to security, please contact us at hello@ollama.com
