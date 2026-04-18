# ───────────── stage 1: install dependencies with uv ─────────────
FROM python:3.12-slim AS builder

# Copy the uv binary from Astral's official image (no pip install needed)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Copy lockfile + pyproject first so dep-install layer caches on code changes
COPY pyproject.toml uv.lock ./

# --frozen: fail if uv.lock is stale; --no-dev: skip dev deps; --no-install-project: defer
# installing the project itself until the source is copied in the runtime stage
RUN uv sync --frozen --no-dev --no-install-project

# ───────────── stage 2: runtime image ─────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Bring in the prebuilt venv from the builder stage
COPY --from=builder /app/.venv /app/.venv

COPY src ./src
COPY pyproject.toml ./

ENV PYTHONPATH=/app/src

EXPOSE 8000

CMD ["uvicorn", "tcsh_ar_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
