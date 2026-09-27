# Smart-Shield map demo. One process serves the desktop UI (/) and
# the mobile UI (/mobile). Model weights are optional: if models/*.joblib
# and models/*.pt are absent, scoring uses the in-repo TF-IDF fallback
# and the vision proxy. See README, "Live demo / deployment".
FROM python:3.11-slim-bookworm

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=5050 \
    SMART_SHIELD_HOST=0.0.0.0

COPY demo/requirements-demo.txt /tmp/requirements-demo.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements-demo.txt

COPY src /app/src
COPY models /app/models
COPY demo /app/demo

WORKDIR /app/demo
EXPOSE 5050

# Torch is not installed in this image (it is large). Vision falls back
# to the existing preset proxy unless you extend the image and add weights.
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 120 api_server:APP"]
