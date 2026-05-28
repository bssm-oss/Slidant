import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


# API key 패턴 (sk-ant-... 등)
_KEY_PATTERN = re.compile(r"sk-[a-zA-Z0-9\-_]{20,}")


class SanitizeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        return response


def sanitize_text(text: str) -> str:
    return _KEY_PATTERN.sub("[REDACTED]", text)
