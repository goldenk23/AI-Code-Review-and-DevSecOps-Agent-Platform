
import subprocess
import os
from pathlib import Path


def retrieve_related_files(workspace, changed_files, max_files=10):
    """
    Given a list of changed files, find related files in the repository.

    Think of this as:
        Changed file  --->  Find its "friends"

    A file's friends can be:
    1. Files living in the same folder.
    2. Files that mention/import/use it.
    3. Its corresponding test files.

    Returns:
        {
            "src/auth/login.py": [
                "src/auth/utils.py",
                "tests/test_login.py",
                ...
            ]
        }
    """
    related = {}

    # Process every changed file independently.
    for changed_file in changed_files:

        # Use a set so duplicate files are automatically removed.
        related_files = set()

        # Convert string into a Path object for easier path operations.
        file_path = Path(changed_file)

        # Parent directory of the changed file.
        directory = file_path.parent

        # ==========================================================
        # Strategy 1:
        # Find files located in the SAME DIRECTORY.
        # ==========================================================
        if directory != Path("."):
            for sibling in directory.glob("*"):
                if sibling.is_file() and str(sibling) != changed_file:
                    related_files.add(str(sibling))

        # ==========================================================
        # Strategy 2:
        # Search the ENTIRE PROJECT for files mentioning this module.
        #
        # Example:
        #   login.py
        #
        # module_name = "login"
        #
        # rg -l login workspace
        #
        # returns every file containing the word "login".
        #
        # ==========================================================
        module_name = file_path.stem

        # Skip very generic filenames because searching for
        # "main", "index", etc. usually produces too many results.
        if module_name and module_name not in ["index", "main", "app"]:
            try:
                result = subprocess.run(
                    ["rg", "-l", module_name, workspace],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                # Each line of stdout contains one matching filename.
                for found_file in result.stdout.strip().split("\n"):
                    if found_file and found_file != changed_file:

                        # Convert absolute path into path relative
                        # to workspace.
                        rel_path = os.path.relpath(found_file, workspace)

                        related_files.add(rel_path)

            # Ignore timeout or missing ripgrep installation.
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass

        # ==========================================================
        # Strategy 3:
        # Search for corresponding TEST FILES.
        #
        # Examples:
        # login.py
        #
        # test_login.py
        # login_test.py
        # login.spec.js
        # loginSpec.ts
        #
        # ==========================================================
        test_patterns = [
            f"**/test*{module_name}*",
            f"**/{module_name}*test*",
            f"**/{module_name}*spec*",
            f"**/*spec*{module_name}*",
        ]

        # Search recursively using each pattern.
        for pattern in test_patterns:
            for found in Path(workspace).glob(pattern):

                rel_path = os.path.relpath(str(found), workspace)

                if rel_path != changed_file:
                    related_files.add(rel_path)

        # Convert set → list and keep at most max_files entries.
        related[changed_file] = list(related_files)[:max_files]

    return related


def read_file_contents(workspace, file_path, max_lines=100):
    """
    Read a file and return its contents.

    Only the first 'max_lines' lines are read.

    Analogy:
    Instead of reading an entire book,
    just read the first few pages to quickly
    understand what it contains.
    """

    # Construct the absolute path of the file.
    full_path = os.path.join(workspace, file_path)

    try:
        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:

            # Stores every line that will be returned.
            lines = []

            # Read line-by-line instead of loading the whole file.
            for i, line in enumerate(f):

                # Stop reading once the maximum limit is reached.
                if i >= max_lines:

                    # Inform the caller that the output was truncated.
                    lines.append(f"... (truncated, {i}+ lines)")
                    break

                # Remove trailing newline before storing.
                lines.append(line.rstrip())

            # Return the collected lines as a single string.
            return "\n".join(lines)

    # If the file doesn't exist, return None instead of crashing.
    except FileNotFoundError:
        return None