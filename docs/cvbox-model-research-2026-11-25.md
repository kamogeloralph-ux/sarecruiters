# CV Box Workers AI model research

Cloudflare's official page for the prior Llama 3.1 model marks the related FP8 model deprecated on 2026-11-20: [Llama 3.1 8B Instruct FP8](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/). The official [Llama 3.2 3B Instruct page](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/) is also marked deprecated on 2026-11-20, so it was not selected as a replacement.

The selected replacement is `@cf/ibm-granite/granite-4.0-h-micro`, documented in Cloudflare's [Granite 4.0 H-Micro model page](https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/). The page lists it as a current Cloudflare-hosted text-generation model without a deprecation marker, shows synchronous Workers AI usage with `messages`, and documents a plain `response` string. That matches the existing `env.AI.run(model, { messages, max_tokens, temperature })` call and the existing JSON extraction path. The page lists zero data retention and lower unit pricing than the larger candidates reviewed.

The implementation now uses this model as the default while preserving the `CF_AI_MODEL` override. The public `POST /api/cv-box/tidy` route returns change, AI-use, model, profession, alternate, fallback-note, and error information. Scheduled six-hour maintenance processes a bounded batch of up to three untidied profiles per tick; temporary AI failures are not cached, so later ticks can retry them. The frontend awaits the tidy request and displays distinct messages for AI corrections, rule-based fallback, no changes, save failures, budget/unavailable conditions, timeouts, and network failures.

## References

[1]: https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/ "Llama 3.1 8B Instruct FP8"
[2]: https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/ "Llama 3.2 3B Instruct"
[3]: https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/ "Granite 4.0 H-Micro"
