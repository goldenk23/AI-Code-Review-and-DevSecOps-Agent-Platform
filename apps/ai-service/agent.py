"""
agent.py — The "brain" of the AI review service.

Job: take a PR's diff + surrounding code context + tool outputs (tests, semgrep, npm audit),
send them to an LLM, and get back a JSON list of findings (bugs, security issues, etc.).

This file is deliberately self-contained: it knows nothing about FastAPI, Postgres, or Redis.
It only knows how to call an OpenAI-compatible chat endpoint and parse the reply.
"""

# --- Standard library imports (built into Python, nothing to install) ---
import json      # parse JSON strings -> Python dicts/lists and back
import os        # read environment variables (config loaded from .env)
import re        # regular expressions — used to find JSON inside a longer text response
import time      # time.sleep() — pause between retries so we don't hammer the API
from typing import Any  # type hint meaning "any type"; here it's mostly dict[str, Any]

# --- Third-party import ---
# httpx is a modern HTTP client for Python (like `requests`, but supports async + more).
# We use it to POST our prompt to the LLM endpoint.
import httpx


# ---------------------------------------------------------------------------
# DEFAULTS
# ---------------------------------------------------------------------------
# OpenCode Go (https://opencode.ai/docs/go/) exposes an OpenAI-compatible
# "chat completions" endpoint. "OpenAI-compatible" means it accepts the same
# JSON request shape as OpenAI's API, so any OpenAI-style client can talk to it.
DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"
DEFAULT_MODEL = "glm-5.2"      # one of the models your Go subscription includes
DEFAULT_TIMEOUT = 60           # give up on the HTTP request if it takes longer than 60s
DEFAULT_MAX_TOKENS = 2000      # cap how long the LLM's answer can be (tokens ~ words/pieces)
DEFAULT_TEMPERATURE = 0.1      # 0.0 = deterministic, 1.0 = creative. Low = consistent reviews.
MAX_RETRIES = 2                # if the call fails, retry up to 2 more times (3 attempts total)


class AgentLoop:
    """Sends PR diff + context + tool results to an OpenAI-compatible LLM
    and returns structured findings. Designed for the OpenCode Go endpoint
    but works with any chat/completions server that honors the same shape.

    Typical use:
        with AgentLoop() as agent:                      # `with` cleans up the HTTP connection
            findings = agent.review_pr(diff, context, tool_results, pr_title)
        # findings is a list like:
        # [{"title": "SQL injection", "severity": "high", "file_path": "...", ...}, ...]
    """

    # The SYSTEM_PROMPT tells the LLM who it is and what format to answer in.
    # It runs once per review and is the same for every PR — only the user content changes.
    # Think of it as the "job description" we give the model.
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

IMPORTANT RULES:
1. Every finding MUST include evidence.
2. If you can't find evidence, don't report the finding.
3. Focus on real issues, not style preferences.
4. Consider the test results and security scan results.

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
        """Set up the agent. Every argument can be passed explicitly OR, if left
        as None, falls back to an environment variable, and finally to a default.

        Why this pattern? So the service can be reconfigured just by editing .env
        without touching code. The order of precedence is:
            explicit argument  >  environment variable  >  DEFAULT_* constant
        """
        # `x or y` returns x if x is truthy, else y. Empty string is falsy, so
        # an unset env var falls through to the default.
        self.api_key = api_key or os.getenv("OPENCODE_GO_API_KEY", "")
        if not self.api_key:
            # Fail fast and clearly — better than a confusing 401 from the API later.
            raise ValueError(
                "OPENCODE_GO_API_KEY is not set. Paste your OpenCode Go key in "
                "apps/ai-service/.env (get it from https://opencode.ai/auth)."
            )
        self.model = model or os.getenv("OPENCODE_GO_MODEL", DEFAULT_MODEL)
        # .rstrip("/") removes a trailing slash if present so we don't end up with
        # "https://.../v1//chat/completions" (double slash) when we build the endpoint.
        self.base_url = (base_url or os.getenv("OPENCODE_GO_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        # int(...) is defensive in case the env var comes through as a string (they always do).
        self.max_tokens = int(max_tokens or os.getenv("OPENCODE_GO_MAX_TOKENS", DEFAULT_MAX_TOKENS))
        self.timeout = int(timeout or os.getenv("OPENCODE_GO_TIMEOUT", DEFAULT_TIMEOUT))

        # The actual URL we will POST to. For OpenCode Go this is
        # https://opencode.ai/zen/go/v1/chat/completions
        self.endpoint = f"{self.base_url}/chat/completions"

        # A persistent HTTP connection. Reusing a single httpx.Client is faster than
        # creating a new one per call (it keeps the TCP/TLS connection warm).
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
        """The public method the rest of the app calls.

        1. Builds a user_prompt by stitching together the PR title, diff, context,
           and tool outputs, truncating each chunk so we don't blow the model's
           context window (LLMs have a max input size, e.g. a few thousand tokens).
        2. Sends system + user prompts to the LLM.
        3. Parses the model's text reply into a Python list of finding dicts.
        """
        # f-string (note the `f`) lets us inject variables into the text. The slices
        # like diff[:8000] mean "take at most the first 8000 characters" — a cheap
        # safety cap so a giant diff doesn't make the request too big to send.
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
        # Two steps: send, then parse. Splitting them makes each easier to test
        # and to reason about ("did the network call fail, or did the LLM return junk?").
        response = self._call_llm(self.SYSTEM_PROMPT, user_prompt)
        return self._parse_findings(response)

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        """POST to the chat completions endpoint and return the model's text reply.

        The `_` prefix is a Python convention meaning "this is internal to the class;
        callers should use the higher-level `review_pr` instead."

        Retries up to MAX_RETRIES times, but ONLY for "transient" errors — the kind
        that might go away if you wait a moment (rate limits, server hiccups,
        network blips). For "this call will never work" errors (e.g. malformed
        response from the API) we give up immediately to avoid wasting attempts.
        """
        # This is the request body. It's the same shape OpenAI's API expects:
        # https://platform.openai.com/docs/api-reference/chat/create
        payload = {
            "model": self.model,
            # `messages` is a conversation. The "system" message primes the model's
            # behavior; the "user" message is the actual thing we want answered.
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": DEFAULT_TEMPERATURE,
            "max_tokens": self.max_tokens,
        }
        # Bearer token auth is the standard way to authenticate to OpenAI-style APIs.
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        last_exc: Exception | None = None  # remember the most recent error so we can report it
        # range(MAX_RETRIES + 1) → 0, 1, 2  (i.e. 3 attempts total: 1 initial + 2 retries)
        for attempt in range(MAX_RETRIES + 1):
            try:
                # Actually send the request. httpx returns a Response object.
                response = self.client.post(self.endpoint, headers=headers, json=payload)

                # Some HTTP status codes mean "the server is overloaded / you're sending
                # too fast" — worth retrying. We convert them into exceptions so the
                # `except` block below handles them uniformly.
                #   429 = Too Many Requests (rate limited)
                #   500/502/503/504 = server-side errors that often clear up on their own
                if response.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(
                        f"HTTP {response.status_code}", request=response.request, response=response
                    )
                # Any other 4xx/5xx also raises. A 4xx here (e.g. 401 bad key) will bubble
                # up to the caller via the `except` below and ultimately the outer `raise`.
                response.raise_for_status()

                # Success — extract the model's text from the JSON response.
                # The OpenAI response shape is:
                #   {"choices": [{"message": {"role": "assistant", "content": "...the text..."}}]}
                data = response.json()
                return data["choices"][0]["message"]["content"]

            except (httpx.HTTPStatusError, httpx.TransportError) as exc:
                # NETWORK / HTTP-LEVEL errors — usually worth retrying.
                last_exc = exc
                if attempt < MAX_RETRIES:              # still have retries left
                    # Exponential backoff: wait longer each time so a struggling server
                    # has a chance to recover, and so we don't worsen a rate-limit storm.
                    #   attempt 0 -> 2**0 = 1s
                    #   attempt 1 -> 2**1 = 2s
                    #   attempt 2 -> 2**2 = 4s
                    backoff = 2 ** attempt
                    print(f"[agent] LLM call failed ({exc}); retrying in {backoff}s")
                    time.sleep(backoff)
                    continue  # go back to the top of the for-loop and try again
                break  # out of retries — fall through to the final raise below

            except (KeyError, ValueError, json.JSONDecodeError) as exc:
                # The HTTP call succeeded, but the BODY wasn't what we expected.
                # Examples: missing "choices" key, body wasn't JSON at all.
                # These won't fix themselves by retrying — return empty so the
                # caller gets a safe "no findings" instead of crashing the whole job.
                print(f"[agent] Malformed LLM response: {exc}")
                return ""

        # We only reach here if we exhausted all retries on a transient error.
        raise RuntimeError(f"LLM call failed after {MAX_RETRIES + 1} attempts: {last_exc}")

    @staticmethod
    def _parse_findings(response: str) -> list[dict[str, Any]]:
        """Turn the model's text reply into a Python list of finding dicts.

        Why is this tricky? The model *should* return raw JSON like:
            [{"title": "...", "severity": "high", ...}]
        ...but in practice LLMs love to wrap it in markdown:
            Here are my findings:
            ```json
            [...]
            ```
        So we try a few increasingly-loose strategies and take the first one that works.
        If nothing parses, we log a snippet and return an empty list (better than crashing).
        """
        if not response:
            return []

        # Strategy 1: the whole response is plain JSON. Best case.
        try:
            parsed = json.loads(response)
            # Make sure it's a list, not a single dict or some other shape.
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass  # not pure JSON — try the next strategy

        # Strategy 2: a markdown code fence ```json ... ``` (or ``` ... ```).
        # The regex means:   ```   optionally the word "json"   whitespace   (anything)   ```
        # re.DOTALL makes `.` match newlines too, so the `.*?` can span multiple lines.
        # `.*?` is non-greedy: it stops at the FIRST closing ```, which is what we want.
        fence = re.search(r"```(?:json)?\s*(.*?)```", response, re.DOTALL)
        if fence:
            try:
                # fence.group(1) is whatever was captured by the (.*?) — the JSON itself.
                parsed = json.loads(fence.group(1))
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass

        # Strategy 3: the model wrote prose around a JSON array. Best effort:
        # grab everything from the first "[" to the LAST "]" and try to parse that.
        # This is loose and can fail (e.g. nested brackets that aren't JSON), but
        # it's a last resort and we silently ignore failure.
        start = response.find("[")
        if start != -1:
            end = response.rfind("]")
            if end > start:
                try:
                    # response[start : end + 1] is a slice from `start` up to and INCLUDING `end`.
                    parsed = json.loads(response[start : end + 1])
                    if isinstance(parsed, list):
                        return parsed
                except json.JSONDecodeError:
                    pass

        # Nothing worked. Print a short snippet for debugging and return []
        # so the caller proceeds as if the model found no issues.
        print(f"[agent] Failed to parse LLM response as JSON: {response[:200]}")
        return []

    def close(self) -> None:
        """Release the underlying HTTP connection. Call when you're done, or use
        the `with AgentLoop() as agent:` form which calls this automatically."""
        self.client.close()

    # These two methods make `with AgentLoop() as agent:` work, just like
    # `with open(...) as f:`. They guarantee close() is called even if an
    # exception is raised while using the agent.
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()