FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NIR_PROJECT_DB_PATH=/app/backend/data/projects.db

WORKDIR /app

COPY backend /app/backend
COPY examples /app/examples

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -e /app/backend

WORKDIR /app/backend
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
