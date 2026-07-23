FROM python:3.11-slim
WORKDIR /app

# Install the external tools the worker shells out to.
# ripgrep is `rg`; semgrep is a pip package; git/npm come from apt.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git npm ripgrep && \
    rm -rf /var/lib/apt/lists/*

COPY requirement.txt .
RUN pip install --no-cache-dir -r requirement.txt semgrep

COPY . .
# No EXPOSE — the worker pulls from Redis, doesn't serve HTTP.
# Prometheus metrics server (port 9090) is internal; expose if you scrape it.
CMD ["python", "worker.py"]
