#!/usr/bin/env python3
"""
Gemini Veo Video Generation Provider.

Uses the Gemini API `predictLongRunning` (LRO) flow for Veo video models.
Supports both the official Google endpoint and a proxy base URL (set via
GEMINI_BASE_URL).

Reference:
  https://ai.google.dev/gemini-api/docs/video
  Model IDs: veo-3.1-generate-001, veo-3.1-fast-generate-001
  (veo-3.0-* will be discontinued on 2026-06-30; prefer 3.1.)
"""

import base64
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests


# =============================================================================
# Constants
# =============================================================================

# IMPORTANT: Veo uses a dedicated base URL env var (`GEMINI_VIDEO_BASE_URL`), NOT
# `GEMINI_BASE_URL`. The latter is consumed by the image-generation skill and
# points at an image-specific proxy path (e.g. `.../v1/images/generations`),
# which would produce invalid request paths for the video LRO API. Video Veo
# needs the API root (or a proxy that mirrors `/v1beta/models/...`).
GEMINI_BASE = os.getenv(
    "GEMINI_VIDEO_BASE_URL", "https://generativelanguage.googleapis.com"
).rstrip("/")

DEFAULT_MODEL = os.getenv("GEMINI_VIDEO_MODEL", "veo-3.1-generate-001")
FAST_MODEL = os.getenv("GEMINI_VIDEO_FAST_MODEL", "veo-3.1-fast-generate-001")

POLL_INTERVAL_SEC = 5
MAX_WAIT_SEC = 1800

# Gemini aspect ratios accepted by Veo.
VALID_ASPECT_RATIOS = {"16:9", "9:16", "1:1"}


# =============================================================================
# Configuration & Authentication
# =============================================================================

def is_configured() -> bool:
    """Return True if a Gemini API key is available.

    Accepts either the video-specific `GEMINI_VIDEO_API_KEY` or the shared
    `GEMINI_API_KEY` (fallback). This lets users reuse a single Google API
    key across image and video skills.
    """
    return bool(os.getenv("GEMINI_VIDEO_API_KEY") or os.getenv("GEMINI_API_KEY"))


def _api_key() -> str:
    # Prefer the video-specific key, fall back to the shared Gemini key.
    key = os.getenv("GEMINI_VIDEO_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError(
            "No Gemini API key found. Set either GEMINI_VIDEO_API_KEY or "
            "GEMINI_API_KEY in your .env (official Google key or proxy key)."
        )
    return key


# =============================================================================
# Helpers
# =============================================================================

def _image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _normalize_aspect_ratio(ratio: str) -> str:
    if ratio not in VALID_ASPECT_RATIOS:
        print(f"  ⚠ Aspect ratio '{ratio}' not in {sorted(VALID_ASPECT_RATIOS)}, defaulting to 16:9")
        return "16:9"
    return ratio


def _model_for(fast_mode: bool) -> str:
    return FAST_MODEL if fast_mode else DEFAULT_MODEL


def _submit_lro(
    model: str,
    prompt: str,
    aspect_ratio: str,
    image_b64: Optional[str],
    negative_prompt: str = "",
) -> str:
    """Submit a predictLongRunning request and return the operation name."""
    instance: Dict[str, Any] = {"prompt": prompt}
    if image_b64:
        instance["image"] = {"bytesBase64Encoded": image_b64}

    parameters: Dict[str, Any] = {
        "aspectRatio": _normalize_aspect_ratio(aspect_ratio),
        "sampleCount": 1,
        # Veo 3.x can generate native audio; enable for richer output.
        "generateAudio": True,
    }
    if negative_prompt:
        parameters["negativePrompt"] = negative_prompt

    body = {
        "instances": [instance],
        "parameters": parameters,
    }

    key = _api_key()
    url = f"{GEMINI_BASE}/v1beta/models/{model}:predictLongRunning?key={key}"

    print(f"Submitting Gemini Veo LRO...")
    print(f"  Model: {model}")
    print(f"  Aspect: {aspect_ratio}")
    print(f"  Image input: {'yes' if image_b64 else 'no'}")

    resp = requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json=body,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Gemini Veo submit failed: HTTP {resp.status_code} - {resp.text[:800]}"
        )

    result = resp.json()
    name = result.get("name")
    if not name:
        raise RuntimeError(f"No operation name in Gemini Veo response: {result}")

    print(f"Operation submitted: {name}")
    return name


def _poll_lro(model: str, op_name: str) -> Dict[str, Any]:
    """Poll a long-running operation until done. Returns the full response dict."""
    key = _api_key()
    # The polling URL uses a path-prefixed operation name.
    # `name` returned by submit is typically "operations/<id>".
    poll_url = (
        f"{GEMINI_BASE}/v1beta/models/{model}:predictLongRunning/{op_name}?key={key}"
    )

    print(f"Waiting for Gemini Veo operation to complete...")
    start = time.time()

    while True:
        elapsed = int(time.time() - start)
        if elapsed > MAX_WAIT_SEC:
            raise TimeoutError(
                f"Gemini Veo operation timed out after {MAX_WAIT_SEC}s ({op_name})"
            )

        resp = requests.get(poll_url, headers={"Content-Type": "application/json"})
        if resp.status_code != 200:
            raise RuntimeError(
                f"Gemini Veo poll failed: HTTP {resp.status_code} - {resp.text[:800]}"
            )

        data = resp.json()
        done = data.get("done", False)
        print(f"  [{elapsed}s] done={done}")

        if done:
            if "error" in data:
                err = data["error"]
                raise RuntimeError(
                    f"Gemini Veo operation failed (code={err.get('code')}): "
                    f"{err.get('message', 'unknown')}"
                )
            return data.get("response", {})

        time.sleep(POLL_INTERVAL_SEC)


def _extract_video_uri(response: Dict[str, Any]) -> str:
    """Extract a downloadable video URI from the LRO response.

    Veo responses look like:
      {"generatedSamples": [{"video": {"uri": "https://..."}}]}
    or include a GCS uri ("gs://...") for some setups.
    """
    samples = response.get("generatedSamples", []) or []
    if not samples:
        raise RuntimeError(f"Gemini Veo returned no generatedSamples: {response}")

    for sample in samples:
        video = sample.get("video", {}) if isinstance(sample, dict) else {}
        uri = video.get("uri") if isinstance(video, dict) else None
        if uri:
            return uri

    raise RuntimeError(f"Gemini Veo samples present but no video.uri found: {response}")


def _download_video(uri: str, output_path: str) -> str:
    """Download a video. Supports http(s) URIs (Veo default).

    For `gs://` URIs the caller would need GCS tooling; we surface a clear
    error in that case.
    """
    if uri.startswith("gs://"):
        raise RuntimeError(
            f"Gemini Veo returned a GCS URI ({uri}) which requires the Google "
            f"Cloud Storage SDK to download. Configure a proxy base URL that "
            f"returns HTTPS URIs instead."
        )

    print(f"Downloading Gemini Veo video...")
    print(f"  URI: {uri}")
    print(f"  Save to: {output_path}")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Veo download URIs require the API key as a query param for some setups.
    key = _api_key()
    sep = "&" if "?" in uri else "?"
    dl_url = f"{uri}{sep}key={key}"

    resp = requests.get(dl_url, stream=True)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Gemini Veo video download failed: HTTP {resp.status_code}"
        )

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Download complete. Size: {size_mb:.2f} MB")
    return output_path


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
    """Generate a video via Gemini Veo.

    - Uses the first valid reference image (if any) as image conditioning.
    - fast_mode=True selects the fast model variant.

    Returns output_file on success. Raises on failure.
    """
    model = _model_for(fast_mode)

    image_b64: Optional[str] = None
    for img in reference_images:
        if img and os.path.exists(img) and os.path.getsize(img) > 0:
            print(f"  Loading reference image: {Path(img).name}")
            image_b64 = _image_to_base64(img)
            break
        if img and len(img) > 100:
            # Assume already base64
            image_b64 = img
            break

    if fast_mode:
        print("Using Gemini Veo fast model")

    op_name = _submit_lro(model, prompt_text, aspect_ratio, image_b64)
    response = _poll_lro(model, op_name)
    uri = _extract_video_uri(response)
    return _download_video(uri, output_file)
