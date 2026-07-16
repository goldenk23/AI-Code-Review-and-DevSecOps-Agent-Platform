import os
import json
import subprocess # run other programs from inside Python. We use this to call git clone, git checkout, and npm test as if we were typing them in the terminal.
import time
import tempfile
import shutil #shutil → "shell utility" — high-level file operations like copying and deleting whole folders. We use shutil.rmtree to wipe the workspace at the end.
import psycopg2 #shutil → "shell utility" — high-level file operations like copying and deleting whole folders. We use shutil.rmtree to wipe the workspace at the end.
import redis
import httpx
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    """ Get postfreSQL connection. """
    return psycopg2.connect(os.getenv("DATABASE_URL"))

def get_redis_connection():
    """ Get Redis connection. """
    return redis.Redis.from_url(os.getenv("REDIS_URL","redis://localhost:6379/0"))

def process_job(job_data):
    """ 
    Process a single analysis job.
    job_data is a dictionary with : run_id, repo_full_name, pr_number, pr_title, head_sha, branch
    """
    run_id = job_data["run_id"]
    repo_full_name = job_data["repo_full_name"]
    pr_number = job_data["pr_number"]
    pr_title = job_data.get("pr_title", "")
    head_sha = job_data["head_sha"]
    branch = job_data["branch"]
    
    print(f"Starting analysis for run #{run_id}: {repo_full_name} PR #{pr_number}")
    
    db = get_db_connection()
    cursor = db.cursor() # Get a cursor to execute SQL queries
    workspace = None
    
    try:
        # Step 1: Update run status to 'running'
        cursor.execute(
            "UPDATE analysis_runs SET status = 'running', started_at = now() WHERE id = %s", (run_id,)
        )
        db.commit() # Commit the transaction to save the status update
        
        # Step 2: clone the repo into a temp directory
        workspace = tempfile.mkdtemp(prefix=f"analysis_{run_id}_")
        print(f"Cloning repository {repo_full_name} into {workspace}")
        
        
        """ 
         subprocess.run(["git", "clone", ...], ...) → run a program (git) with arguments (clone, the URL, the destination). It's like typing git clone https://github.com/owner/repo.git /tmp/analysis-42-abc in the terminal.
        
        """
        clone_result = subprocess.run(
            ["git", "clone", f"https://github.com/{repo_full_name}.git", workspace],
            capture_output=True, text=True, timeout=60
        )
        if clone_result.returncode != 0:
            raise Exception(f"git clone failed: {clone_result.stderr}")
        
        # checkout the PR branch
        checkout_result = subprocess.run(
            ["git", "checkout", branch],
            cwd=workspace,
            capture_output=True, text=True, timeout=30
        )
        if checkout_result.returncode != 0:
            raise Exception(f"git checkout failed: {checkout_result.stderr}")
        
        
        # Step 3: Run npm test
        """ 
        - create_job(cursor, run_id, "test") → inserts a new row and returns its id (see the helper below).
        - run_command(cursor, db, test_job_id, workspace, ["npm", "test"]) → run npm test in the workspace, and save its output to that specific job row. (Helper below.)
        
        """
        test_job_id = create_job(cursor, run_id, "test")
        test_command = detect_test_command(workspace)
        print(f"Detected test command for run #{run_id}: {' '.join(test_command)}")
        run_command(cursor, db, test_job_id, workspace, test_command)
        
        # Step 4: Update run status to 'completed'
        cursor.execute(
            "UPDATE analysis_runs SET status = 'completed', completed_at = now() WHERE id = %s", (run_id,)
        )
        db.commit()
        print(f"Analysis for run #{run_id} completed successfully.")
        
    except Exception as exc:
        print(f"Analysis failed for run #{run_id}: {exc}")
        cursor.execute(
            "UPDATE analysis_runs SET status = 'failed', error = %s, completed_at = now() WHERE id = %s",
            (str(exc), run_id)
        )
        db.commit()
        
    finally:
        # Clean up the workspace
        if workspace and os.path.exists(workspace):
            shutil.rmtree(workspace)
        cursor.close()
        db.close()
        

def detect_test_command(workspace):
    """Pick the right test command based on the files present in the repo."""
    if os.path.exists(os.path.join(workspace, "package.json")):
        return ["npm", "test"]
    if os.path.exists(os.path.join(workspace, "requirements.txt")) or os.path.exists(os.path.join(workspace, "pyproject.toml")):
        return ["pytest", "-q"]
    return ["echo", "no tests configured for this project"]


def create_job(cursor, run_id, job_type):
    """Create an analysis_job record and return its ID."""
    cursor.execute(
        "INSERT INTO analysis_jobs (run_id, job_type, status) VALUES (%s, %s, 'running') RETURNING id",
        (run_id, job_type)
    )
    return cursor.fetchone()[0]

def run_command(cursor, db, job_id, workspace, command):
    """Run a command, capture output, and save to database."""
    try:
        result = subprocess.run(
            command, cwd=workspace,
            capture_output=True, text=True, timeout=120
        )
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout + result.stderr, job_id)
        )
        db.commit()
        return result
    except subprocess.TimeoutExpired:
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 124, logs = 'Command timed out', completed_at = now() WHERE id = %s",
            (job_id,)
        )
        db.commit()
        raise Exception(f"Command {command} timed out")
    
def main():
    """ main worker loop: fetch jobs from Redis and process them. """
    redis_conn = get_redis_connection()
    print("Worker started. Waiting for jobs on Redis queue 'ai_review_jobs'...")
    while True:
        # BRPOP blocks until a job is available (with 1-second timeout for graceful shutdown)
        """ - r.brpop("ai_review_jobs", timeout=1) → the magic line. BRPOP = "Blocking Right POP" — it pulls the rightmost item from the list (the oldest if you push with LPUSH, or newest if RPUSH — depends on which side the producer uses). The "B" part is the important bit: it blocks — sleeps inside Redis until something is available, instead of you hammering Redis with "anything yet? anything yet?" every millisecond. Way more efficient.  """
        result = redis_conn.brpop("ai_review_jobs", timeout=1)
        if result is None:
            continue  # No job, loop again
        
        # result is a tuple (queue_name, job_data), where job_data is a JSON string
        _, message = result
        job_data = json.loads(message)
        
        try:
            process_job(job_data)
        except Exception as e:
            print(f"Error processing job: {e}")
            # Optionally, you could push the job back to Redis or log it for later inspection
if __name__ == "__main__":
    main()