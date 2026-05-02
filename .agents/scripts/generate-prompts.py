#!/usr/bin/env python3
"""
Generate self-contained prompt files from tasks.json.

Usage: python3 generate-prompts.py [path/to/tasks.json]

Output: tasks/TASK-XXXX-prompt (one per task)
"""
import json, os, sys

tasks_path = sys.argv[1] if len(sys.argv) > 1 else "tasks.json"

if not os.path.exists(tasks_path):
    print(f"ERROR: {tasks_path} not found", file=sys.stderr)
    sys.exit(1)

with open(tasks_path) as f:
    data = json.load(f)

project_dir = os.getcwd()
tasks_dir = os.path.join(project_dir, "tasks")
os.makedirs(tasks_dir, exist_ok=True)

tasks = data["tasks"]
count = 0

for t in tasks:
    tid = t["id"]
    deps = ", ".join(t["dependencies"]) if t["dependencies"] else "(none)"
    experts = ", ".join(t["moeExperts"])

    prompt = f"""WORKDIR: {project_dir}
TASK_ID: {tid}
TASK_TITLE: {t["title"]}
AGENT: {t["agent"]}
MOE_EXPERTS: {experts}
PHASE: {t["phase"]}
DEPS: {deps}

DESCRIPTION:
{t["description"]}

WHAT YOU MUST DO:
Read relevant source files (use ls/find to discover them, read to examine),
then implement the changes. Write real code using edit/write/bash tools.
After implementing, verify each acceptance criterion listed below.

ACCEPTANCE CRITERIA:
"""
    for ac in t["acceptanceCriteria"]:
        prompt += f"- {ac}\n"

    prompt += f"""
EXPERT PERSPECTIVES TO CONSIDER:
{chr(10).join(f"- {e}" for e in t["moeExperts"])}

AFTER COMPLETION:
Write "{tid}_DONE" to tasks/{tid}.done
"""

    path = os.path.join(tasks_dir, f"{tid}-prompt")
    with open(path, "w") as f:
        f.write(prompt)
    count += 1

print(f"Generated {count} prompt files in {tasks_dir}/")
