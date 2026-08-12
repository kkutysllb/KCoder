"""Network and web tool configuration.

Holds the global proxy address shared by all web-facing tools (web_search,
image_search, web_fetch, browser automation) plus default knobs for each tool
family. Per-tool config (``config.tools[].proxy`` etc.) takes precedence over
the values defined here.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class NetworkConfig(BaseModel):
    """Network and web tool configuration.

    A single ``proxy`` field drives the proxy used by every web tool so users
    only configure it once. Empty / ``None`` means *direct connection*.
    Supported formats:

    * ``http://host:port``
    * ``https://host:port``
    * ``socks5://host:port``
    """

    model_config = ConfigDict(extra="allow")

    proxy: str | None = Field(
        default=None,
        description=(
            "Global HTTP/SOCKS proxy for all web tools. "
            "Example: http://127.0.0.1:7890 or socks5://127.0.0.1:7891. "
            "Empty string or null disables the proxy (direct connection)."
        ),
    )

    # -- web_search (DuckDuckGo) -------------------------------------------------
    web_search_max_results: int = Field(
        default=5,
        ge=1,
        le=50,
        description="Maximum number of results returned by web_search.",
    )

    # -- web_fetch (Jina AI Reader) ----------------------------------------------
    web_fetch_timeout: int = Field(
        default=10,
        ge=1,
        le=120,
        description="Timeout in seconds for each web_fetch request.",
    )

    # -- image_search (DuckDuckGo Images) ----------------------------------------
    image_search_max_results: int = Field(
        default=5,
        ge=1,
        le=50,
        description="Maximum number of images returned by image_search.",
    )

    # -- browser automation (Playwright) -----------------------------------------
    browser_headless: bool = Field(
        default=True,
        description="Run the headless Chromium instance (no visible window).",
    )
    browser_viewport_width: int = Field(
        default=1280,
        ge=320,
        le=3840,
        description="Browser viewport width in pixels.",
    )
    browser_viewport_height: int = Field(
        default=720,
        ge=240,
        le=2160,
        description="Browser viewport height in pixels.",
    )
    browser_timeout_ms: int = Field(
        default=30000,
        ge=1000,
        le=120000,
        description="Default Playwright navigation / action timeout in milliseconds.",
    )
