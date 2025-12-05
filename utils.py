

# === FILE: /backend/utils.py ===
import os
import uuid
from fastapi import UploadFile


def save_upload_file(upload_file: UploadFile, upload_dir: str) -> str:
    """Save uploaded file to specified directory and return file ID."""
    filename = upload_file.filename or "file"
    ext = os.path.splitext(filename)[1]
    file_id = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, file_id)
    with open(file_path, "wb") as buffer:
        content = upload_file.file.read()
        buffer.write(content)
    return file_id