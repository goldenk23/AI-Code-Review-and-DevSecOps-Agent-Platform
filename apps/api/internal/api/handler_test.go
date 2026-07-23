package api

import "testing"

// TestParseRepoFullName checks the owner/repo splitter.
func TestParseRepoFullName(t *testing.T) {
	cases := []struct {
		in       string
		wantOwn  string
		wantRepo string
	}{
		{"acme/web", "acme", "web"},
		{"goldenk23/AI-Code-Review", "goldenk23", "AI-Code-Review"},
		{"malformed", "", ""}, // no slash
		{"a/b/c", "", ""},     // too many slashes
	}
	for _, c := range cases {
		owner, repo := parseRepoFullName(c.in)
		if owner != c.wantOwn || repo != c.wantRepo {
			t.Errorf("parseRepoFullName(%q) = (%q,%q), want (%q,%q)",
				c.in, owner, repo, c.wantOwn, c.wantRepo)
		}
	}
}

// TestCommentTag confirms the tag format the bot uses to find its own comments.
func TestCommentTag(t *testing.T) {
	got := commentTag(42)
	want := "<!-- ai-review-run:42 -->"
	if got != want {
		t.Errorf("commentTag(42) = %q, want %q", got, want)
	}
}

// TestParsePatchForGitHub checks we extract the suggestion snippet + line range
// from a unified diff hunk header.
func TestParsePatchForGitHub(t *testing.T) {
	patch := `@@ -2,3 +2,3 @@
 context
-old
+new
 last
`
	snippet, start, end := parsePatchForGitHub(patch)
	if start != 2 || end != 4 {
		t.Errorf("lines = (%d,%d), want (2,4)", start, end)
	}
	if snippet != "context\nnew\nlast" {
		t.Errorf("snippet = %q, want %q", snippet, "context\nnew\nlast")
	}
}
