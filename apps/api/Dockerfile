# ───────────── stage 1: install dependencies with Poetry ─────────────
FROM python:3.12-slim AS builder

ENV POETRY_VERSION=1.8.4 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_NO_INTERACTION=1 \
    PIP_NO_CACHE_DIR=1

RUN pip install "poetry==$POETRY_VERSION"

WORKDIR /app

COPY pyproject.toml poetry.lock* ./

RUN poetry install --only main --no-root

# ───────────── stage 2: runtime image ─────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/usr/local/bin:$PATH"

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY src ./src
COPY pyproject.toml ./

ENV PYTHONPATH=/app/src

EXPOSE 8000

CMD ["uvicorn", "tcsh_ar_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
