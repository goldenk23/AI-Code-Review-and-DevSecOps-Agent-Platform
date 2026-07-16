import hmac, hashlib, json, sys, time, urllib.request

secret = b"testsecret123"

REPO_FULL_NAME = "goldenk23/AI-Code-Review-and-DevSecOps-Agent-Platform"

payload = {
    "action": "opened",
    "pull_request": {
        "number": 1,
        "title": "Test PR",
        "head": {"sha": f"test{int(time.time())}", "ref": "main"},
        "user": {"login": "goldenk23"},
    },
    "repository": {
        "id": 123,
        "name": "AI-Code-Review-and-DevSecOps-Agent-Platform",
        "full_name": REPO_FULL_NAME,
        "owner": {"login": "goldenk23"},
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