"""KCoder QiLin Gateway.

A thin FastAPI translation layer that exposes KCoder's existing /v1/* HTTP API
contract (originally backed by the QiongQi engine) on top of the QiLin agent
engine running as a LangGraph Platform service.

This package lives entirely inside the KCoder repository. The QiLin engine
repository (https://github.com/kkutysllb/QiLin) is consumed only as a pip
dependency and is never modified.
"""

__version__ = "0.1.0"
