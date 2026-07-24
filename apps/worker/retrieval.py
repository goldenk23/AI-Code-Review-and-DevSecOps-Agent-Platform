import subprocess
import os
from pathlib import Path


def retrieve_related_files(workspace, changed_files, max_files=10):
    """Given a list of changed files, find related files in the repository:
    siblings in the same directory, files referencing the module, and matching
    test files.

    Returns a dict mapping each changed file to a list of related paths, e.g.
        {"src/auth/login.py": ["src/auth/utils.py", "tests/test_login.py"]}
    """
    related = {}

    for changed_file in changed_files:

        related_files = set()

        file_path = Path(changed_file)
        directory = file_path.parent

        # Strategy 1: files in the same directory.
        if directory != Path("."):
            for sibling in directory.glob("*"):
                if sibling.is_file() and str(sibling) != changed_file:
                    related_files.add(str(sibling))

        # Strategy 2: files across the project that reference the module name.
        module_name = file_path.stem

        # Skip very generic names; searching "main"/"index" matches too much.
        if module_name and module_name not in ["index", "main", "app"]:
            try:
                result = subprocess.run(
                    ["rg", "-l", module_name, workspace],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                for found_file in result.stdout.strip().split("\n"):
                    if found_file and found_file != changed_file:
                        rel_path = os.path.relpath(found_file, workspace)
                        related_files.add(rel_path)

            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass

        # Strategy 3: matching test files (test_x, x_test, x.spec, ...).
        test_patterns = [
            f"**/test*{module_name}*",
            f"**/{module_name}*test*",
            f"**/{module_name}*spec*",
            f"**/*spec*{module_name}*",
        ]

        for pattern in test_patterns:
            for found in Path(workspace).glob(pattern):

                rel_path = os.path.relpath(str(found), workspace)

                if rel_path != changed_file:
                    related_files.add(rel_path)

        related[changed_file] = list(related_files)[:max_files]

    return related


def read_file_contents(workspace, file_path, max_lines=100):
    """Read up to max_lines lines of a file and return them as a string, or
    None if the file doesn't exist."""

    full_path = os.path.join(workspace, file_path)

    try:
        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:

            lines = []

            for i, line in enumerate(f):

                if i >= max_lines:
                    lines.append(f"... (truncated, {i}+ lines)")
                    break

                lines.append(line.rstrip())

            return "\n".join(lines)

    except FileNotFoundError:
        return None
