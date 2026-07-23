"""
agent.py — The "brain" of the AI review service.

Job: take a PR's diff + surrounding code context + tool outputs (tests, semgrep, npm audit),
send them to an LLM, and get back a JSON list of findings (bugs, security issues, etc.).

This file is deliberately self-contained: it knows nothing about FastAPI, Postgres, or Redis.
It only knows how to call an OpenAI-compatible chat endpoint and parse the reply.
"""

import json
import os
import re
import time
from typing import Any

import httpx


DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"
DEFAULT_MODEL = "glm-5.2"
DEFAULT_TIMEOUT = 60
DEFAULT_MAX_TOKENS = 4000
DEFAULT_TEMPERATURE = 0.1
MAX_RETRIES = 2


class AgentLoop:
    """Sends PR diff + context + tool results to an OpenAI-compatible LLM
    and returns structured findings. Designed for the OpenCode Go endpoint
    but works with any chat/completions server that honors the same shape.

    Typical use:
        with AgentLoop() as agent:
            findings = agent.review_pr(diff, context, tool_results, pr_title)
    """

    SYSTEM_PROMPT = """You are an expert code reviewer. Analyze the following pull request \
and identify issues. For each issue, provide:
- title: A short one-line summary
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "correctness", "security", "performance", "testing", "maintainability"
- file_path: The file where the issue is
- line_start: The line number (if known)
- description: A detailed explanation
- evidence: A quote from the diff or tool output that proves this issue exists
- confidence: A number from 0.0 to 1.0 indicating how sure you are
- suggested_patch: A unified diff patch that fixes this issue (see format below)

SUGGESTED PATCH FORMAT:
- Provide a unified diff (the format `git diff` produces) that can be applied with `git apply`.
- Use the format: --- a/path/to/file\\n+++ b/path/to/file\\n@@ -start,count +start,count @@\\n context lines\\n-removed lines\\n+added lines
- Only include a suggested_patch when you are confident the fix is correct.
- If you cannot suggest a fix, set suggested_patch to null.

IMPORTANT RULES:
1. Every finding MUST include evidence.
2. If you can't find evidence, don't report the finding.
3. Focus on real issues, not style preferences.
4. Consider the test results and security scan results.
5. The suggested_patch must be a valid unified diff that applies cleanly with `git apply`.

Return your findings as a JSON array. If there are no issues, return an empty array [].
Respond with ONLY the JSON array, no prose, no markdown fences.
"""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        max_tokens: int | None = None,
        timeout: int | None = None,
    ):
        self.api_key = api_key or os.getenv("OPENCODE_GO_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "OPENCODE_GO_API_KEY is not set. Paste your OpenCode Go key in "
                "apps/ai-service/.env (get it from https://opencode.ai/auth)."
            )
        self.model = model or os.getenv("OPENCODE_GO_MODEL", DEFAULT_MODEL)
        self.base_url = (base_url or os.getenv("OPENCODE_GO_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        self.max_tokens = int(max_tokens or os.getenv("OPENCODE_GO_MAX_TOKENS", DEFAULT_MAX_TOKENS))
        self.timeout = int(timeout or os.getenv("OPENCODE_GO_TIMEOUT", DEFAULT_TIMEOUT))
        self.endpoint = f"{self.base_url}/chat/completions"
        self.client = httpx.Client(timeout=self.timeout)

    def review_pr(
        self,
        diff: str,
        context: str,
        tool_results: str,
        pr_title: str,
        max_diff_chars: int = 8000,
        max_context_chars: int = 4000,
        max_tool_chars: int = 4000,
    ) -> list[dict[str, Any]]:
        user_prompt = (
            f"# Pull Request: {pr_title}\n\n"
            "## Changed Files Diff\n"
            "```\n"
            f"{diff[:max_diff_chars]}\n"
            "```\n\n"
            "## Related Code Context\n"
            "```\n"
            f"{context[:max_context_chars]}\n"
            "```\n\n"
            "## Tool Results (tests, security scans)\n"
            "```\n"
            f"{tool_results[:max_tool_chars]}\n"
            "```\n\n"
            "Analyze this PR and return findings as a JSON array.\n"
        )
        response = self._call_llm(self.SYSTEM_PROMPT, user_prompt)
        return self._parse_findings(response)

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": DEFAULT_TEMPERATURE,
            "max_tokens": self.max_tokens,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        last_exc: Exception | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self.client.post(self.endpoint, headers=headers, json=payload)

                if response.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(
                        f"HTTP {response.status_code}", request=response.request, response=response
                    )
                response.raise_for_status()

                data = response.json()
                return data["choices"][0]["message"]["content"]

            except (httpx.HTTPStatusError, httpx.TransportError) as exc:
                last_exc = exc
                if attempt < MAX_RETRIES:
                    backoff = 2 ** attempt
                    print(f"[agent] LLM call failed ({exc}); retrying in {backoff}s")
                    time.sleep(backoff)
                    continue
                break

            except (KeyError, ValueError, json.JSONDecodeError) as exc:
                print(f"[agent] Malformed LLM response: {exc}")
                return ""

        raise RuntimeError(f"LLM call failed after {MAX_RETRIES + 1} attempts: {last_exc}")

    @staticmethod
    def _parse_findings(response: str) -> list[dict[str, Any]]:
        if not response:
            return []

        try:
            parsed = json.loads(response)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

        fence = re.search(r"```(?:json)?\s*(.*?)```", response, re.DOTALL)
        if fence:
            try:
                parsed = json.loads(fence.group(1))
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass

        start = response.find("[")
        if start != -1:
            end = response.rfind("]")
            if end > start:
                try:
                    parsed = json.loads(response[start : end + 1])
                    if isinstance(parsed, list):
                        return parsed
                except json.JSONDecodeError:
                    pass

        print(f"[agent] Failed to parse LLM response as JSON: {response[:200]}")
        return []

    def close(self) -> None:
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()