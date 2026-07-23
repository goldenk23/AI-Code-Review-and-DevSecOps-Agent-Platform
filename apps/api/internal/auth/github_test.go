package auth

import "testing"

func TestGitHubNextLink(t *testing.T) {
	header := `<https://api.github.com/user/repos?page=1>; rel="prev", <https://api.github.com/user/repos?page=3>; rel="next"`
	want := "https://api.github.com/user/repos?page=3"
	if got := githubNextLink(header); got != want {
		t.Fatalf("githubNextLink() = %q, want %q", got, want)
	}
	if got := githubNextLink(""); got != "" {
		t.Fatalf("empty Link header returned %q", got)
	}
}
