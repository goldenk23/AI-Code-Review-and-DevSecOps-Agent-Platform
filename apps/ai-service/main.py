import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

from agent import AgentLoop

# override=True: the .env file is the source of truth. Without it, python-dotenv
# does NOT overwrite variables already present in the process environment -- and
# start.ps1 injects the ai-service .env into its own env before launching us, so
# a value that was correct when the launcher started would shadow a later .env
# edit. Making .env win means editing .env + restarting THIS process is always
# enough; no stale inherited value can survive.
load_dotenv(override=True)

if not os.getenv("OPENCODE_GO_API_KEY"):
    raise RuntimeError("OPENCODE_GO_API_KEY is required")

app = FastAPI(title="AI Review Service", version="0.1.0")

@app.get("/health")
async def health():
    return {"status": "ok"}

class ReviewRequest(BaseModel):
    run_id: int
    repo_full_name: str
    pr_number: int
    pr_title: str
    diff: str
    changed_files: list[str]
    context_files: dict[str, str]
    tool_results: dict[str, str]

@app.post("/review")
async def review(request: ReviewRequest):
    context = "\n\n".join(
        f"--- {path} ---\n{content}"
        for path, content in request.context_files.items()
    )
    tool_results = "\n\n".join(
        f"--- {tool} ---\n{output}"
        for tool, output in request.tool_results.items()
    )

    try:
        with AgentLoop() as agent:
            findings = agent.review_pr(
                diff=request.diff,
                context=context,
                tool_results=tool_results,
                pr_title=request.pr_title,
            )
    except ValueError as e:
        # Missing API key / misconfiguration
        raise HTTPException(status_code=500, detail=str(e))
    except RuntimeError as e:
        # LLM call failed after retries
        raise HTTPException(status_code=502, detail=str(e))

    return {"run_id": request.run_id, "findings": findings}