#!/usr/bin/env python3
"""
Kling Video Generation Provider.

Supports both text-to-video and image-to-video generation via the Kling AI API.

Authentication (auto-detected by available env vars):
  1. Official JWT mode  : KLING_ACCESS_KEY + KLING_SECRET_KEY
  2. Proxy Bearer mode  : KLING_API_KEY (+ optional KLING_BASE_URL)

Both modes share the same request/response shape; only the Authorization
header differs.
"""

import base64
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import jwt
import requests


# =============================================================================
# Constants
# =============================================================================

KLING_BASE_URL = os.getenv("KLING_BASE_URL", "https://api-beijing.klingai.com").rstrip("/")
DEFAULT_MODEL = os.getenv("KLING_MODEL", "kling-v2-6")

POLL_INTERVAL_SEC = 5
MAX_WAIT_SEC = 1800
TOKEN_EXPIRE_SEC = 1800

# Kling aspect ratio mapping. Kling accepts "16:9", "9:16", "1:1" directly.
VALID_ASPECT_RATIOS = {"16:9", "9:16", "1:1"}


# =============================================================================
# Configuration & Authentication
# =============================================================================

def is_configured() -> bool:
    """Return True if Kling provider has enough credentials configured.

    Supports two modes:
      - Official JWT  : both KLING_ACCESS_KEY and KLING_SECRET_KEY present
      - Proxy Bearer  : KLING_API_KEY present
    """
    if os.getenv("KLING_ACCESS_KEY") and os.getenv("KLING_SECRET_KEY"):
        return True
    if os.getenv("KLING_API_KEY"):
        return True
    return False


def _auth_headers() -> Dict[str, str]:
    """Build Authorization headers.

    Prefers official JWT when access_key + secret_key are both set; falls back
    to Bearer proxy mode when only KLING_API_KEY is present.
    """
    access_key = os.getenv("KLING_ACCESS_KEY")
    secret_key = os.getenv("KLING_SECRET_KEY")

    if access_key and secret_key:
        # Official JWT mode
        now = int(time.time())
        payload = {
            "iss": access_key,
            "exp": now + TOKEN_EXPIRE_SEC,
            "nbf": now - 5,
        }
        headers = {"alg": "HS256", "typ": "JWT"}
        token = jwt.encode(payload, secret_key, algorithm="HS256", headers=headers)
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    api_key = os.getenv("KLING_API_KEY")
    if api_key:
        # Proxy Bearer mode
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    raise RuntimeError(
        "Kling API credentials not configured.\n"
        "Set either:\n"
        "  KLING_ACCESS_KEY + KLING_SECRET_KEY  (official JWT mode)\n"
        "or\n"
        "  KLING_API_KEY                        (proxy Bearer mode)\n"
        "Optionally KLING_BASE_URL to point to a proxy endpoint."
    )


# =============================================================================
# Image Helpers
# =============================================================================

def _image_to_base64(image_path: str) -> str:
    """Read an image file and return its base64-encoded content."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _normalize_aspect_ratio(ratio: str) -> str:
    """Validate and return a Kling-compatible aspect ratio string."""
    if ratio not in VALID_ASPECT_RATIOS:
        # Default to 16:9 for anything unexpected rather than failing hard.
        print(f"  ⚠ Aspect ratio '{ratio}' not in {sorted(VALID_ASPECT_RATIOS)}, defaulting to 16:9")
        return "16:9"
    return ratio


# =============================================================================
# Task Management
# =============================================================================

def _create_text2video_task(
    prompt: str,
    model_name: str,
    duration: str,
    mode: str,
    aspect_ratio: str,
) -> Dict[str, Any]:
    """Create a text-to-video generation task.

    Returns the task data dict (with task_id, task_status).
    """
    body: Dict[str, Any] = {
        "model_name": model_name,
        "prompt": prompt,
        "duration": duration,
        "mode": mode,
        "aspect_ratio": _normalize_aspect_ratio(aspect_ratio),
    }

    print(f"Creating Kling text2video task...")
    print(f"  Model: {model_name}")
    print(f"  Mode: {mode}")
    print(f"  Duration: {duration}s")
    print(f"  Aspect: {aspect_ratio}")

    resp = requests.post(
        f"{KLING_BASE_URL}/v1/videos/text2video",
        headers=_auth_headers(),
        json=body,
    )
    return _parse_task_response(resp, "create text2video task")


def _create_image2video_task(
    image_start: str,
    prompt: str,
    model_name: str,
    duration: str,
    mode: str,
    aspect_ratio: str,
    image_end: Optional[str] = None,
) -> Dict[str, Any]:
    """Create an image-to-video generation task.

    image_start is used as the first frame. If image_end is provided, it acts
    as the last frame (first-last-frame generation).

    `image_start` / `image_end` may be either a filesystem path or a pre-encoded
    base64 string.
    """
    def _load_image(img: str) -> str:
        if os.path.exists(img):
            print(f"  Loading image: {Path(img).name}")
            return _image_to_base64(img)
        return img  # assume already base64-encoded

    body: Dict[str, Any] = {
        "model_name": model_name,
        "image": _load_image(image_start),
        "prompt": prompt,
        "duration": duration,
        "mode": mode,
        "aspect_ratio": _normalize_aspect_ratio(aspect_ratio),
    }
    if image_end:
        body["image_tail"] = _load_image(image_end)

    gen_type = "first-last frame" if image_end else "first-frame"
    print(f"Creating Kling image2video task ({gen_type})...")
    print(f"  Model: {model_name}")
    print(f"  Mode: {mode}")
    print(f"  Duration: {duration}s")

    resp = requests.post(
        f"{KLING_BASE_URL}/v1/videos/image2video",
        headers=_auth_headers(),
        json=body,
    )
    return _parse_task_response(resp, "create image2video task")


def _query_task(task_id: str, kind: str) -> Dict[str, Any]:
    """Query a task by id. `kind` is 'text2video' or 'image2video'."""
    url = f"{KLING_BASE_URL}/v1/videos/{kind}/{task_id}"
    resp = requests.get(url, headers=_auth_headers())

    if resp.status_code != 200:
        raise RuntimeError(
            f"Failed to query Kling task {task_id}: "
            f"HTTP {resp.status_code} - {resp.text[:500]}"
        )

    result = resp.json()
    # Official Kling API: {"code": 0, "data": {...}}
    # Some proxies return the data directly.
    if result.get("code") not in (0, None):
        raise RuntimeError(
            f"Kling query error (code={result.get('code')}): "
            f"{result.get('message', 'unknown')}"
        )
    return result.get("data", result)


def _wait_for_completion(task_id: str, kind: str) -> Dict[str, Any]:
    """Poll a task until it reaches a terminal state."""
    print(f"Waiting for Kling task completion (ID: {task_id})...")
    start = time.time()

    while True:
        elapsed = int(time.time() - start)
        if elapsed > MAX_WAIT_SEC:
            raise TimeoutError(
                f"Kling task timed out after {MAX_WAIT_SEC}s (ID: {task_id})"
            )

        data = _query_task(task_id, kind)
        status = data.get("task_status", "")

        print(f"  [{elapsed}s] Kling task status: {status}")

        if status == "succeed":
            print(f"Kling task completed in {elapsed}s")
            return data
        if status == "failed":
            msg = data.get("task_status_msg", "unknown error")
            raise RuntimeError(f"Kling task failed (ID: {task_id}): {msg}")

        # submitted / processing  -> keep polling
        time.sleep(POLL_INTERVAL_SEC)


def _download_video(url: str, output_path: str) -> str:
    """Download a video to output_path, creating parent dirs as needed."""
    print(f"Downloading Kling video...")
    print(f"  URL: {url}")
    print(f"  Save to: {output_path}")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    resp = requests.get(url, stream=True)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Kling video download failed: HTTP {resp.status_code}"
        )

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Download complete. Size: {size_mb:.2f} MB")
    return output_path


# =============================================================================
# Response Parsing
# =============================================================================

def _parse_task_response(resp: requests.Response, action: str) -> Dict[str, Any]:
    """Validate a task-creation response and return the inner `data` object."""
    if resp.status_code != 200:
        raise RuntimeError(
            f"Failed to {action}: HTTP {resp.status_code} - {resp.text[:500]}"
        )

    result = resp.json()
    # Official: {"code": 0, "data": {"task_id": ..., "task_status": ...}}
    if result.get("code") not in (0, None):
        raise RuntimeError(
            f"Failed to {action} (code={result.get('code')}): "
            f"{result.get('message', 'unknown')}"
        )

    data = result.get("data", result)
    if "task_id" not in data:
        raise RuntimeError(f"No task_id in Kling response: {result}")

    print(f"Task created: {data['task_id']}  (status: {data.get('task_status', 'submitted')})")
    return data


def _extract_video_url(data: Dict[str, Any]) -> str:
    """Extract the first video URL from a completed task data object."""
    result = data.get("task_result", {})
    videos: List[Dict[str, Any]] = result.get("videos", []) if isinstance(result, dict) else []
    if not videos:
        raise RuntimeError(f"Kling task succeeded but no videos returned: {data}")
    url = videos[0].get("url")
    if not url:
        raise RuntimeError(f"Kling video entry has no url: {videos[0]}")
    return url


# =============================================================================
# Public API
# =============================================================================

def generate(
    prompt_text: str,
    reference_images: List[str],
    output_file: str,
    aspect_ratio: str = "16:9",
    fast_mode: bool = False,
) -> str:
    """Generate a video via Kling.

    - If reference_images is non-empty, uses image2video (first image as first
      frame; if a second image is present, it becomes the last frame).
    - Otherwise uses text2video.
    - fast_mode=True -> mode='pro'; otherwise mode='std'.

    Returns output_file on success. Raises on failure.
    """
    model_name = DEFAULT_MODEL
    duration = "5"
    mode = "pro" if fast_mode else "std"

    # Pick endpoint & build task
    if reference_images:
        valid = [img for img in reference_images if _is_valid_image_ref(img)]
        if not valid:
            print("  No valid reference images; falling back to text2video")
            task_data = _create_text2video_task(prompt_text, model_name, duration, mode, aspect_ratio)
            kind = "text2video"
        else:
            start_img = valid[0]
            end_img = valid[1] if len(valid) >= 2 else None
            task_data = _create_image2video_task(
                image_start=start_img,
                image_end=end_img,
                prompt=prompt_text,
                model_name=model_name,
                duration=duration,
                mode=mode,
                aspect_ratio=aspect_ratio,
            )
            kind = "image2video"
    else:
        task_data = _create_text2video_task(prompt_text, model_name, duration, mode, aspect_ratio)
        kind = "text2video"

    if fast_mode:
        print("Using Kling pro mode (fast quota)")

    # Poll
    completed = _wait_for_completion(task_data["task_id"], kind)

    # Download
    video_url = _extract_video_url(completed)
    return _download_video(video_url, output_file)


def _is_valid_image_ref(image: str) -> bool:
    """Check whether an image reference is usable (existing path or non-empty string)."""
    if not image:
        return False
    if os.path.exists(image):
        try:
            return os.path.getsize(image) > 0
        except OSError:
            return False
    # Treat as base64 string; accept if reasonably long.
    return len(image) > 100
