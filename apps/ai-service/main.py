import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

from agent import AgentLoop

load_dotenv()

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