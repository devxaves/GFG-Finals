import shutil
import os

base = 'c:/Users/biswa/OneDrive/Desktop/TruthScope-Final'

dirs_to_delete = [
    os.path.join(base, 'extension', 'backend')
]

files_to_delete = [
    'COMPLETE_SETUP_GUIDE.md',
    'CONFIGURATION_CHANGES.md',
    'DEBUG_SIGNIN.md',
    'JSON_FORMAT_FIX.md',
    'TESTING_INSTRUCTIONS.md',
    'overview.md',
    'propmt.md',
    'final_output.json',
    'extension/CODEBASE_DESCRIPTION.md',
    'landing/fact-check-api/0.24.0',
    'landing/fact-check-api/test_apis.py'
]

for d in dirs_to_delete:
    shutil.rmtree(d, ignore_errors=True)
    print(f"Deleted dir: {d}")

for f in files_to_delete:
    p = os.path.join(base, f)
    if os.path.exists(p):
        os.remove(p)
        print(f"Deleted file: {p}")

print("Cleanup script complete.")
