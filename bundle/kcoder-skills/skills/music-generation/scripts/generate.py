import base64
import json
import os
import tempfile

import requests

# MiniMax API base URL (domestic: api.minimaxi.com, international: api.minimax.io)
MINIMAX_API_BASE = os.getenv("MINIMAX_BASE_URL", "https://api.minimaxi.com").rstrip("/v1")

# ── Available models ──────────────────────────────────────────────
# music-2.6:   Text-to-music generation. Supports instrumental & vocal modes.
# music-cover: Cover/remix from a reference audio track.
# Both have "-free" variants (music-2.6-free, music-cover-free) which use
# lower RPM but are available to all users via API Key.
MODEL_TEXT2MUSIC = "music-2.6"
MODEL_COVER = "music-cover"


# ── Lyrics generation ─────────────────────────────────────────────
def generate_lyrics(prompt: str, mode: str = "write_full_song") -> dict:
    """Generate structured lyrics via MiniMax Lyrics Generation API.

    Args:
        prompt: Description of the song theme, style, mood.
        mode: 'write_full_song' (default) or 'edit'.

    Returns:
        dict with keys: song_title, style_tags, lyrics.
    """
    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        raise RuntimeError("MINIMAX_API_KEY is not set")

    body = {
        "mode": mode,
        "prompt": prompt,
    }

    resp = requests.post(
        f"{MINIMAX_API_BASE}/v1/lyrics_generation",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
    )
    resp.raise_for_status()
    result = resp.json()

    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise RuntimeError(
            f"Lyrics API error (code={base_resp.get('status_code')}): "
            f"{base_resp.get('status_msg', 'unknown')}"
        )

    return {
        "song_title": result.get("song_title", ""),
        "style_tags": result.get("style_tags", ""),
        "lyrics": result.get("lyrics", ""),
    }


# ── Music generation (text2music) ──────────────────────────────────
def generate_music_text2music(
    prompt: str,
    output_file: str,
    *,
    lyrics: str | None = None,
    is_instrumental: bool = False,
    lyrics_optimizer: bool = False,
    audio_format: str = "mp3",
    sample_rate: int = 44100,
    bitrate: int = 256000,
) -> str:
    """Generate music from a text prompt using MiniMax Music-2.6.

    Args:
        prompt: Style/mood/scene description (1-2000 chars).
        output_file: Absolute path for the output audio file.
        lyrics: Optional lyrics with section tags ([Verse], [Chorus], etc.).
        is_instrumental: If True, generate instrumental only (no vocals).
        lyrics_optimizer: If True and lyrics is empty, auto-generate lyrics.
        audio_format: mp3, wav, or flac.
        sample_rate: Audio sample rate.
        bitrate: Audio bitrate in bps.

    Returns:
        Success message string.
    """
    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        return "MINIMAX_API_KEY is not set"

    body: dict = {
        "model": MODEL_TEXT2MUSIC,
        "prompt": prompt,
        "is_instrumental": is_instrumental,
        "audio_setting": {
            "sample_rate": sample_rate,
            "bitrate": bitrate,
            "format": audio_format,
        },
        "output_format": "hex",
        "lyrics_optimizer": lyrics_optimizer,
    }

    if lyrics:
        body["lyrics"] = lyrics

    resp = requests.post(
        f"{MINIMAX_API_BASE}/v1/music_generation",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
    )
    resp.raise_for_status()
    result = resp.json()

    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise RuntimeError(
            f"Music API error (code={base_resp.get('status_code')}): "
            f"{base_resp.get('status_msg', 'unknown')}"
        )

    hex_audio = result.get("data", {}).get("audio")
    if not hex_audio:
        raise RuntimeError("Music generation returned no audio data")

    with open(output_file, "wb") as f:
        f.write(bytes.fromhex(hex_audio))

    extra = result.get("extra_info", {})
    duration_ms = extra.get("music_duration", 0)
    duration_s = duration_ms / 1000 if duration_ms else 0

    return (
        f"Music generated successfully to {output_file} "
        f"(duration: {duration_s:.1f}s)"
    )


# ── Cover generation ──────────────────────────────────────────────
def generate_music_cover(
    prompt: str,
    output_file: str,
    *,
    reference_audio_path: str | None = None,
    reference_audio_url: str | None = None,
    lyrics: str | None = None,
    audio_format: str = "mp3",
    sample_rate: int = 44100,
    bitrate: int = 256000,
) -> str:
    """Generate a cover/remix from a reference audio using MiniMax Music-Cover.

    Either reference_audio_path or reference_audio_url must be provided.
    If lyrics is omitted, the system will extract lyrics automatically from
    the reference audio via ASR.

    Args:
        prompt: Target cover style description (10-300 chars).
        output_file: Absolute path for the output audio file.
        reference_audio_path: Local file path to a reference audio (6s-6min, <50MB).
        reference_audio_url: URL to a reference audio file.
        lyrics: Optional new lyrics (10-1000 chars).
        audio_format: mp3, wav, or flac.
        sample_rate: Audio sample rate.
        bitrate: Audio bitrate in bps.

    Returns:
        Success message string.
    """
    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        return "MINIMAX_API_KEY is not set"

    if not reference_audio_path and not reference_audio_url:
        raise ValueError(
            "Cover mode requires either --reference-audio (local file) "
            "or a reference audio URL."
        )

    body: dict = {
        "model": MODEL_COVER,
        "prompt": prompt,
        "audio_setting": {
            "sample_rate": sample_rate,
            "bitrate": bitrate,
            "format": audio_format,
        },
        "output_format": "hex",
    }

    if reference_audio_path:
        with open(reference_audio_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("utf-8")
        body["audio_base64"] = audio_b64
    elif reference_audio_url:
        body["audio_url"] = reference_audio_url

    if lyrics:
        body["lyrics"] = lyrics

    resp = requests.post(
        f"{MINIMAX_API_BASE}/v1/music_generation",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
    )
    resp.raise_for_status()
    result = resp.json()

    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise RuntimeError(
            f"Cover API error (code={base_resp.get('status_code')}): "
            f"{base_resp.get('status_msg', 'unknown')}"
        )

    hex_audio = result.get("data", {}).get("audio")
    if not hex_audio:
        raise RuntimeError("Cover generation returned no audio data")

    with open(output_file, "wb") as f:
        f.write(bytes.fromhex(hex_audio))

    extra = result.get("extra_info", {})
    duration_ms = extra.get("music_duration", 0)
    duration_s = duration_ms / 1000 if duration_ms else 0

    return (
        f"Music cover generated successfully to {output_file} "
        f"(duration: {duration_s:.1f}s)"
    )


# ── Full pipeline: lyrics → music ─────────────────────────────────
def generate_full_song(
    prompt: str,
    output_file: str,
    *,
    is_instrumental: bool = False,
    audio_format: str = "mp3",
) -> str:
    """Generate lyrics AND music in one call.

    1. Generates lyrics from the prompt via Lyrics Generation API.
    2. Feeds the generated lyrics into Music-2.6 to produce the song.

    Args:
        prompt: Song theme/style description.
        output_file: Absolute path for the output audio file.
        is_instrumental: Force instrumental even though lyrics exist.
        audio_format: mp3, wav, or flac.

    Returns:
        Success message with song details.
    """
    # Step 1: Generate lyrics
    print("Step 1/2: Generating lyrics...")
    lyrics_data = generate_lyrics(prompt)
    song_title = lyrics_data["song_title"]
    style_tags = lyrics_data["style_tags"]
    lyrics = lyrics_data["lyrics"]

    print(f"  Title: {song_title}")
    print(f"  Style: {style_tags}")
    print(f"  Lyrics: {len(lyrics)} chars")

    # Step 2: Generate music with lyrics
    print("Step 2/2: Generating music...")
    result = generate_music_text2music(
        prompt=style_tags or prompt,
        output_file=output_file,
        lyrics=lyrics,
        is_instrumental=is_instrumental,
        audio_format=audio_format,
    )

    return result


# ── CLI ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate music using MiniMax API (3 models)"
    )

    # ── Mode ──
    parser.add_argument(
        "--mode",
        choices=["text2music", "cover", "lyrics", "full"],
        default="text2music",
        help=(
            "Generation mode:\n"
            "  text2music — Generate music from text prompt (music-2.6)\n"
            "  cover      — Generate cover from reference audio (music-cover)\n"
            "  lyrics     — Generate lyrics only (no music)\n"
            "  full       — Generate lyrics + music in one step"
        ),
    )

    # ── Prompt ──
    parser.add_argument(
        "--prompt",
        default="",
        help="Music theme/style description. Can also use --prompt-file.",
    )
    parser.add_argument(
        "--prompt-file",
        default="",
        help="Path to a file containing the prompt text.",
    )

    # ── Lyrics ──
    parser.add_argument(
        "--lyrics",
        default="",
        help="Lyrics text with section tags ([Verse], [Chorus], etc.)",
    )
    parser.add_argument(
        "--lyrics-file",
        default="",
        help="Path to a file containing lyrics text.",
    )
    parser.add_argument(
        "--auto-lyrics",
        action="store_true",
        default=False,
        help="Auto-generate lyrics from prompt (uses lyrics_optimizer for text2music).",
    )

    # ── Instrumental ──
    parser.add_argument(
        "--is-instrumental",
        action="store_true",
        default=False,
        help="Generate instrumental music only (no vocals).",
    )

    # ── Cover / reference audio ──
    parser.add_argument(
        "--reference-audio",
        default="",
        help="Path to a reference audio file for cover mode (6s-6min, <50MB).",
    )

    # ── Output ──
    parser.add_argument(
        "--output-file",
        required=True,
        help="Absolute path for the output audio file.",
    )
    parser.add_argument(
        "--format",
        choices=["mp3", "wav", "flac"],
        default="mp3",
        help="Output audio format (default: mp3).",
    )

    args = parser.parse_args()

    # ── Resolve prompt ──
    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8") as f:
            prompt = f.read().strip()
    else:
        prompt = args.prompt.strip()

    # ── Resolve lyrics ──
    lyrics = ""
    if args.lyrics_file:
        with open(args.lyrics_file, "r", encoding="utf-8") as f:
            lyrics = f.read().strip()
    elif args.lyrics:
        lyrics = args.lyrics.strip()

    try:
        if args.mode == "lyrics":
            if not prompt:
                print("Error: --prompt or --prompt-file is required for lyrics mode.")
                exit(1)
            result = generate_lyrics(prompt)
            # Save lyrics to a JSON file alongside the output for reference
            lyrics_file = args.output_file.rsplit(".", 1)[0] + "_lyrics.json"
            with open(lyrics_file, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            print(f"Lyrics saved to {lyrics_file}")

        elif args.mode == "cover":
            if not prompt:
                print("Error: --prompt is required for cover mode.")
                exit(1)
            if not args.reference_audio:
                print("Error: --reference-audio is required for cover mode.")
                exit(1)
            result = generate_music_cover(
                prompt=prompt,
                output_file=args.output_file,
                reference_audio_path=args.reference_audio or None,
                lyrics=lyrics or None,
                audio_format=args.format,
            )
            print(result)

        elif args.mode == "full":
            if not prompt:
                print("Error: --prompt or --prompt-file is required for full mode.")
                exit(1)
            result = generate_full_song(
                prompt=prompt,
                output_file=args.output_file,
                is_instrumental=args.is_instrumental,
                audio_format=args.format,
            )
            print(result)

        else:  # text2music
            if not prompt:
                print("Error: --prompt or --prompt-file is required for text2music mode.")
                exit(1)
            result = generate_music_text2music(
                prompt=prompt,
                output_file=args.output_file,
                lyrics=lyrics or None,
                is_instrumental=args.is_instrumental,
                lyrics_optimizer=args.auto_lyrics,
                audio_format=args.format,
            )
            print(result)

    except Exception as e:
        print(f"Error while generating music: {e}")
