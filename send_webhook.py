import hmac, hashlib, json, sys, urllib.request

secret = b"testsecret123"

payload = {
    "action": "opened",
    "pull_request": {
        "number": 1,
        "title": "Test PR",
        "head": {"sha": "abc123", "ref": "feature/test"},
        "user": {"login": "testuser"},
    },
    "repository": {
        "id": 123,
        "name": "test",
        "full_name": "test/repo",
        "owner": {"login": "test"},
    },
}

body = json.dumps(payload).encode()
sig = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
print("Signature:", sig)

req = urllib.request.Request(
    "http://localhost:8080/webhooks/github",
    data=body,
    headers={
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-Hub-Signature-256": sig,
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req) as resp:
        print(resp.status, resp.read().decode())
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode())