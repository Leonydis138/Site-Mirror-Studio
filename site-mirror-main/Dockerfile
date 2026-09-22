FROM python:3.10-slim

WORKDIR /app

# Install system dependencies if needed for compilation/networking
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and config
COPY . .

# Run the orchestration script by default
CMD ["python", "main.py"]
