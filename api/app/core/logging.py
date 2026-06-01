import logging
import sys
import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


def setup_logging(is_production: bool = False) -> None:
    level = logging.INFO

    fmt = "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s"
    datefmt = "%H:%M:%S"

    logging.basicConfig(
        level=level,
        format=fmt,
        datefmt=datefmt,
        stream=sys.stdout,
        force=True,
    )

    # uvicorn access 로그 포맷 통일
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True

    # 노이즈 줄이기
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


logger = logging.getLogger("slidant")


class LoggingMiddleware(BaseHTTPMiddleware):
    SKIP_PATHS = {"/health"}

    async def dispatch(self, request: Request, call_next):
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        t0 = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - t0) * 1000

        status = response.status_code
        level = logging.WARNING if status >= 400 else logging.INFO
        logger.log(
            level,
            "%s %s  %d  %.0fms",
            request.method,
            request.url.path,
            status,
            ms,
        )
        return response
