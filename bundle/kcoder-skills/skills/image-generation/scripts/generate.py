import base64
import io
import json
import mimetypes
import os
import sys

import requests
from PIL import Image

# ---------------------------------------------------------------------------
# Provider configuration (priority order)
#   1. Gemini/Doubao  (OpenAI-compatible images/generations endpoint)
#   2. GPT/Image2     (OpenAI-compatible images/generations endpoint)
# ---------------------------------------------------------------------------
_GPT_IMAGE2_API_KEY = os.getenv("GPT_IMAGE2_API_KEY")
_GPT_IMAGE2_BASE_URL = os.getenv("GPT_IMAGE2_BASE_URL", "")
_GPT_IMAGE2_MODEL = os.getenv("GPT_IMAGE2_MODEL", "gpt-image-2")

_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
_GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "")
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "doubao-seedream-5-0-260128")



def _select_provider() -> str:
    """Return the first provider with credentials configured."""
    if _GEMINI_API_KEY and _GEMINI_BASE_URL:
        return "gemini"
    if _GPT_IMAGE2_API_KEY and _GPT_IMAGE2_BASE_URL:
        return "gpt-image2"
    return ""


def validate_image(image_path: str) -> bool:
    """
    Validate if an image file can be opened and is not corrupted.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        True if the image is valid and can be opened, False otherwise
    """
    try:
        with Image.open(image_path) as img:
            img.verify()  # Verify that it's a valid image
        # Re-open to check if it can be fully loaded (verify() may not catch all issues)
        with Image.open(image_path) as img:
            img.load()  # Force load the image data
        return True
    except Exception as e:
        print(f"Warning: Image '{image_path}' is invalid or corrupted: {e}")
        return False


def _get_mime_type(file_path: str) -> str:
    """Detect MIME type from file path, defaulting to image/jpeg."""
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type and mime_type.startswith("image/"):
        return mime_type
    return "image/jpeg"


def generate_image(
    prompt_file: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str = "16:9",
) -> str:
    with open(prompt_file, "r", encoding="utf-8") as f:
        prompt = f.read()

    # Validate reference images
    valid_reference_images = []
    for ref_img in reference_images:
        if validate_image(ref_img):
            valid_reference_images.append(ref_img)
        else:
            print(f"Skipping invalid reference image: {ref_img}")

    if len(valid_reference_images) < len(reference_images):
        print(
            f"Note: {len(reference_images) - len(valid_reference_images)} "
            f"reference image(s) were skipped due to validation failure."
        )

    provider = _select_provider()
    if not provider:
        return "Error: No image generation provider configured. Set GPT_IMAGE2_API_KEY or GEMINI_API_KEY."

    print(f"Using provider: {provider}")

    if provider == "gpt-image2":
        return _generate_gpt_image2(prompt, valid_reference_images, output_file, aspect_ratio)
    else:
        return _generate_gemini(prompt, valid_reference_images, output_file, aspect_ratio)


def _aspect_ratio_to_size(aspect_ratio: str) -> str:
    """Convert aspect ratio string (e.g. '16:9') to OpenAI size string (e.g. '1024x1024')."""
    _SIZE_MAP = {
        "1:1": "1024x1024",
        "16:9": "1536x1024",
        "9:16": "1024x1536",
        "4:3": "1536x1024",
        "3:4": "1024x1536",
        "3:2": "1536x1024",
        "2:3": "1024x1536",
    }
    return _SIZE_MAP.get(aspect_ratio, "1024x1024")


def _generate_gpt_image2(
    prompt: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str,
) -> str:
    """Generate image using GPT/Image2 (OpenAI-compatible) API."""
    request_body: dict = {
        "model": _GPT_IMAGE2_MODEL,
        "prompt": prompt,
        "n": 1,
        "size": _aspect_ratio_to_size(aspect_ratio),
        "quality": "low",
        "format": "jpeg",
    }

    # Add reference images if provided
    if reference_images:
        input_images = []
        for ref_img in reference_images:
            mime_type = _get_mime_type(ref_img)
            with open(ref_img, "rb") as f:
                image_b64 = base64.b64encode(f.read()).decode("utf-8")
            input_images.append({
                "type": "input_image",
                "image_url": f"data:{mime_type};base64,{image_b64}",
            })

    response = requests.post(
        _GPT_IMAGE2_BASE_URL,
        headers={
            "Authorization": f"Bearer {_GPT_IMAGE2_API_KEY}",
            "Content-Type": "application/json",
        },
        json=request_body,
        timeout=120,
    )
    response.raise_for_status()
    result = response.json()

    # Extract image data
    data_list = result.get("data", [])
    if data_list:
        item = data_list[0]
        b64 = item.get("b64_json", "")
        if b64:
            # Strip data URL prefix if present
            if b64.startswith("data:"):
                b64 = b64.split(",", 1)[1]
            with open(output_file, "wb") as f:
                f.write(base64.b64decode(b64))
            return f"Successfully generated image to {output_file} (provider: gpt-image2)"
        url = item.get("url", "")
        if url:
            img_resp = requests.get(url, timeout=60)
            img_resp.raise_for_status()
            with open(output_file, "wb") as f:
                f.write(img_resp.content)
            return f"Successfully generated image to {output_file} (provider: gpt-image2)"

    raise Exception(
        f"GPT/Image2 API returned no image data. Response: {json.dumps(result)[:500]}"
    )


def _generate_gemini(
    prompt: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str,
) -> str:
    """Generate image using Gemini-compatible (OpenAI images/generations) API."""
    request_body: dict = {
        "model": _GEMINI_MODEL,
        "prompt": prompt,
        "n": 1,
        "size": _aspect_ratio_to_size(aspect_ratio),
    }

    response = requests.post(
        _GEMINI_BASE_URL,
        headers={
            "Authorization": f"Bearer {_GEMINI_API_KEY}",
            "Content-Type": "application/json",
        },
        json=request_body,
        timeout=120,
    )
    response.raise_for_status()
    result = response.json()

    # Extract image data (supports both b64_json and url response)
    data_list = result.get("data", [])
    if data_list:
        item = data_list[0]
        b64 = item.get("b64_json", "")
        if b64:
            if b64.startswith("data:"):
                b64 = b64.split(",", 1)[1]
            with open(output_file, "wb") as f:
                f.write(base64.b64decode(b64))
            return f"Successfully generated image to {output_file} (provider: gemini/{_GEMINI_MODEL})"
        url = item.get("url", "")
        if url:
            img_resp = requests.get(url, timeout=60)
            img_resp.raise_for_status()
            with open(output_file, "wb") as f:
                f.write(img_resp.content)
            return f"Successfully generated image to {output_file} (provider: gemini/{_GEMINI_MODEL})"

    raise Exception(
        f"Gemini API returned no image data. Response: {json.dumps(result)[:500]}"
    )



if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate images (Gemini -> GPT/Image2)")
    parser.add_argument(
        "--prompt-file",
        required=True,
        help="Absolute path to JSON prompt file",
    )
    parser.add_argument(
        "--reference-images",
        nargs="*",
        default=[],
        help="Absolute paths to reference images (space-separated)",
    )
    parser.add_argument(
        "--output-file",
        required=True,
        help="Output path for generated image",
    )
    parser.add_argument(
        "--aspect-ratio",
        required=False,
        default="16:9",
        help="Aspect ratio of the generated image",
    )

    args = parser.parse_args()

    try:
        print(
            generate_image(
                args.prompt_file,
                args.reference_images,
                args.output_file,
                args.aspect_ratio,
            )
        )
    except Exception as e:
        print(f"Error while generating image: {e}")
