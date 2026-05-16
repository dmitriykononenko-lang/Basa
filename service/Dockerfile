FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Сначала ставим только зависимости — слой кешируется между пересборками,
# пока pyproject.toml не меняется.
COPY pyproject.toml ./
RUN pip install --upgrade pip
# Editable install: исходники остаются по /app, изменения подхватываются
# в dev-режиме через bind-mount в docker-compose, без переустановки пакета.
# В production это тоже безопасно — пакет всё равно зарегистрирован.
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
COPY web ./web
RUN pip install -e .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
