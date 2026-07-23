"""Tests for the AI service's LLM-response parser.

Run with:  cd apps/ai-service && python -m pytest test_agent.py -v
"""

from agent import AgentLoop


def test_parse_plain_json():
    """Best case: the model returned a raw JSON array."""
    resp = '[{"title": "bug", "severity": "high"}]'
    out = AgentLoop._parse_findings(resp)
    assert len(out) == 1
    assert out[0]["title"] == "bug"


def test_parse_markdown_fence():
    """Model wrapped JSON in ```json ... ``` fences."""
    resp = 'Here are my findings:\n```json\n[{"title": "x"}]\n```\n'
    out = AgentLoop._parse_findings(resp)
    assert len(out) == 1
    assert out[0]["title"] == "x"


def test_parse_prose_around_array():
    """Model wrote prose before/after the JSON array."""
    resp = 'I found 1 issue:\n[{"title": "y"}]\nHope this helps!'
    out = AgentLoop._parse_findings(resp)
    assert len(out) == 1
    assert out[0]["title"] == "y"


def test_parse_empty_response():
    """Empty string -> empty list (don't crash)."""
    assert AgentLoop._parse_findings("") == []


def test_parse_garbage_returns_empty():
    """Unparseable text -> empty list, not an exception."""
    assert AgentLoop._parse_findings("not json at all") == []


def test_parse_fence_without_language_tag():
    """Model wrapped JSON in bare ``` fences (no 'json' tag)."""
    resp = "```\n[{\"title\": \"z\"}]\n```"
    out = AgentLoop._parse_findings(resp)
    assert len(out) == 1
    assert out[0]["title"] == "z"


def test_parse_object_not_list_returns_empty():
    """A JSON object (not an array) isn't a findings list -> []."""
    assert AgentLoop._parse_findings('{"title": "x"}') == []


def test_parse_multiple_findings_preserved_in_order():
    """Every finding in the array comes back, in order."""
    resp = '[{"title": "a"}, {"title": "b"}, {"title": "c"}]'
    out = AgentLoop._parse_findings(resp)
    assert [f["title"] for f in out] == ["a", "b", "c"]
