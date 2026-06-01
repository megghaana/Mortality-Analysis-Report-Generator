import os
import uuid
from pathlib import Path

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "data/storage"))
UPLOAD_DIR = STORAGE_ROOT / "uploads"

def safe_filename(filename):
    return Path(filename).name.replace(" ", "_")

def save_file(file):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    filename = safe_filename(file.filename)
    file_path = UPLOAD_DIR / f"{file_id}_{filename}"
    with file_path.open("wb") as output:
        output.write(file.file.read())
    return str(file_path)
