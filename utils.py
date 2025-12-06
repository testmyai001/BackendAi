# === FILE: /backend/utils.py ===
import os
import uuid
from fastapi import UploadFile
from typing import Optional


def safe_filename(filename: Optional[str]) -> str:
    """
    Sanitizes the uploaded filename:
    - Removes dangerous characters
    - Prevents path traversal
    - Ensures plain ASCII, no spaces
    """
    if not filename:
        return "file"

    # Normalize separators
    filename = filename.replace("\\", "/")

    # Extract base name only
    filename = filename.split("/")[-1]

    # Allow only safe characters
    filename = "".join(
        c for c in filename if c.isalnum() or c in ("-", "_", ".")
    )

    if "." not in filename:
        return filename + ".dat"

    return filename


def save_upload_file(upload_file: UploadFile, upload_dir: str) -> str:
    """
    Production-safe file saving:
    ✔ Streams in chunks (supports 100MB PDFs/images)
    ✔ Prevents memory overflow
    ✔ Sanitizes filenames
    ✔ Returns unique file_id with original extension
    """
    os.makedirs(upload_dir, exist_ok=True)

    original = safe_filename(upload_file.filename)
    _, ext = os.path.splitext(original)
    ext = ext.lower() or ".dat"

    file_id = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, file_id)

    # Stream write file in chunks
    with open(file_path, "wb") as buffer:
        while True:
            chunk = upload_file.file.read(1024 * 1024)  # 1MB chunks
            if not chunk:
                break
            buffer.write(chunk)

    return file_id
