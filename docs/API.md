# GortGPT Developer API

GortGPT exposes a bearer-token API for external programs. The API runs through this project's own Cloudflare Worker and selected GortGPT module; it does not give callers the upstream provider's secret key.

## Create a token

1. Sign in to GortGPT.
2. Open **Settings → Developer API tokens**.
3. Create a token, copy it immediately, and store it in a secret manager or environment variable.
4. Never commit a token to Git, expose it in browser JavaScript, or share it publicly. Revoke it from Settings if it leaks.

## Endpoint

- Base URL: `https://openai.xzort.workers.dev/v1`
- Chat completions: `POST /chat/completions`
- Models: `GET /models`
- Authentication: `Authorization: Bearer gort_…`
- Supported modules: `ai-engine`, `gort`, `code-copilot`, `security-analyst`, `study-tutor`, `vision-ai`

This initial API version accepts text messages and non-streaming responses. Image payloads and `stream: true` are not supported yet. Calls consume the same account's GortGPT daily allowance/bonus credits and appear in usage metering.

## cURL

Set `GORTGPT_API_KEY` in your environment, then run:

```bash
curl https://openai.xzort.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer $GORTGPT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "code-copilot",
    "messages": [
      {"role": "user", "content": "Write a Python function to check if a number is prime."}
    ]
  }'
```

## Python

```python
import os
import requests

response = requests.post(
    "https://openai.xzort.workers.dev/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {os.environ['GORTGPT_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "model": "ai-engine",
        "messages": [
            {"role": "user", "content": "Explain async/await with a short example."}
        ],
    },
    timeout=90,
)
response.raise_for_status()
data = response.json()
print(data["choices"][0]["message"]["content"])
```

## JavaScript (Node.js)

```javascript
const response = await fetch("https://openai.xzort.workers.dev/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.GORTGPT_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "study-tutor",
    messages: [{ role: "user", content: "Explain recursion with an example." }],
  }),
});

if (!response.ok) throw new Error(await response.text());
const data = await response.json();
console.log(data.choices[0].message.content);
```

## Response shape

Successful calls return an OpenAI-style `chat.completion` object with `choices[0].message.content` and approximate token counts. The usage numbers are estimates derived from character counts, not exact provider token accounting. API tokens are stored as SHA-256 hashes; the original token is returned only at creation time.
