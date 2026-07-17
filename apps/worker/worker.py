import os
import json
import subprocess # run other programs from inside Python. We use this to call git clone, git checkout, and npm test as if we were typing them in the terminal.
import time
import tempfile
import stat
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
        if test_command is None:
            cursor.execute(
                "UPDATE analysis_jobs SET status = 'completed', exit_code = 0, logs = 'no tests configured for this project', completed_at = now() WHERE id = %s",
                (test_job_id,)
            )
            db.commit()
            print(f"No tests configured for run #{run_id}; skipping test step.")
        else:
            print(f"Detected test command for run #{run_id}: {' '.join(test_command)}")
            run_command(cursor, db, test_job_id, workspace, test_command)
            run_semgrep(cursor, db, run_id, workspace)
            run_npm_audit(cursor, db, run_id, workspace)
            
        
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
            safe_rmtree(workspace)
        cursor.close()
        db.close()
        

def safe_rmtree(path):
    """Like shutil.rmtree, but handles read-only files (git pack files are read-only on Windows)."""
    def _on_error(func, p, _exc_info):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            pass
    try:
        shutil.rmtree(path, onexc=_on_error)
    except TypeError:
        shutil.rmtree(path, onerror=_on_error)


def detect_test_command(workspace):
    """Pick the right test command based on the files present in the repo. Returns None if no tests are configured."""
    if os.path.exists(os.path.join(workspace, "package.json")):
        return ["npm", "test"]
    if os.path.exists(os.path.join(workspace, "requirements.txt")) or os.path.exists(os.path.join(workspace, "pyproject.toml")):
        return ["pytest", "-q"]
    return None


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
    
def run_semgrep(cursor, db, run_id, workspace):
    """Run Semgrep security scan and save findings to the database."""
    job_id = create_job(cursor, run_id, "semgrep")
    
    # Use custom rules if available, otherwise fall back to auto
    custom_rules = os.path.join(os.path.dirname(__file__), "custom_semgrep_rule.yml")
    config = custom_rules if os.path.exists(custom_rules) else "auto"
    
    try:
        result = subprocess.run(
            ["semgrep", "scan", "--json", f"--config={config}", workspace],
            capture_output=True, text=True, timeout=120
        )
        
        semgrep_output = json.loads(result.stdout)
        
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout, job_id)
        )
        db.commit()
        
        for finding in semgrep_output.get("results", []):
            severity = map_semgrep_severity(finding.get("extra", {}).get("severity", "INFO"))
            cursor.execute(
                """INSERT INTO findings (run_id, file_path, line_start, line_end, severity, category, 
                   title, description, evidence, confidence, verification_status)
                   VALUES (%s, %s, %s, %s, %s, 'security', %s, %s, %s, 0.9, 'verified_by_static_analysis')""",
                (run_id, finding.get("path", ""), 
                 finding.get("start", {}).get("line"),
                 finding.get("end", {}).get("line"),
                 severity,
                 finding.get("check_id", "semgrep finding"),
                 finding.get("extra", {}).get("message", ""),
                 finding.get("extra", {}).get("lines", ""))
            )
        db.commit()
        print(f"Semgrep found {len(semgrep_output.get('results', []))} issues")
        
    except Exception as e:
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = %s, completed_at = now() WHERE id = %s",
            (str(e), job_id)
        )
        db.commit()
        raise

def map_semgrep_severity(semgrep_severity):
    mapping = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
    return mapping.get(semgrep_severity.upper(), "low")


def run_npm_audit(cursor, db, run_id, workspace):
    """Run npm audit and save vulnerable dependencies as findings."""
    job_id = create_job(cursor, run_id, "npm_audit")
    
    try:
        result = subprocess.run(
            ["npm", "audit", "--json"],
            cwd=workspace, capture_output=True, text=True, timeout=60
        )
        
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout, job_id)
        )
        db.commit()
        
        try:
            audit = json.loads(result.stdout)
            vulnerabilities = audit.get("vulnerabilities", {})
            
            for pkg_name, pkg_info in vulnerabilities.items():
                severity = pkg_info.get("severity", "low")
                via_list = pkg_info.get("via", [])
                via_str = ", ".join(str(v) for v in via_list) if via_list else "unknown"
                
                cursor.execute(
                    """INSERT INTO findings (run_id, file_path, severity, category, title, description, 
                       confidence, verification_status)
                       VALUES (%s, 'package.json', %s, 'dependency_risk', %s, %s, 0.95, 'verified_by_static_analysis')""",
                    (run_id, severity,
                     f"Vulnerable dependency: {pkg_name}",
                     f"Package '{pkg_name}' has {severity} severity vulnerability. Via: {via_str}")
                )
            db.commit()
            print(f"npm audit found {len(vulnerabilities)} vulnerable packages")
            
        except json.JSONDecodeError:
            print("npm audit output was not valid JSON")
            
    except Exception as e:
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', logs = %s, completed_at = now() WHERE id = %s",
            (str(e), job_id)
        )
        db.commit()
        raise

    
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