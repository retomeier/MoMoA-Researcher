# ==========================================
# Stage 1: Tool Builder (Temporary)
# Used to download and compile tools only
# ==========================================
FROM golang:1.24-alpine AS tools

# Install lightweight tools needed for downloading
RUN apk add --no-cache curl wget git

ENV CGO_ENABLED=0
# RUN go install github.com/mgechev/revive@latest

# 1. Build Staticcheck from source (Reliable, no broken links)
# RUN go install honnef.co/go/tools/cmd/staticcheck@latest

# 2. Download Ktlint
WORKDIR /downloads
RUN curl -sSLO https://github.com/pinterest/ktlint/releases/download/1.3.1/ktlint && \
    chmod a+x ktlint

# 3. Download Hadolint
RUN wget -O hadolint https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64 && \
    chmod +x hadolint

# 4. Download Checkstyle JAR
# We prepare the directory structure here to copy it cleanly later
RUN mkdir -p linter-tool-definition-files && \
    wget -O linter-tool-definition-files/checkstyle-10.23.1-all.jar https://github.com/checkstyle/checkstyle/releases/download/checkstyle-10.23.1/checkstyle-10.23.1-all.jar

# ==========================================
# Stage 2: Final Application Image
# This is the actual image that will run
# ==========================================
FROM node:22-slim
WORKDIR /usr/src/app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    python3-flake8 \
    python3-pip \
    default-jre-headless \
    maven \
    clang-tidy \
    ssh \
    curl \
    gnupg \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Google Cloud CLI (gcloud)
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] http://packages.cloud.google.com/apt cloud-sdk main" | \
    tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
    gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    apt-get update -y && \
    apt-get install google-cloud-cli -y && \
    rm -rf /var/lib/apt/lists/*

# 2. Install numpy using pip
# We use --break-system-packages because Debian's managed environment 
# prefers venvs, but for a container, this is generally acceptable.
RUN pip install --no-cache-dir --break-system-packages numpy

RUN mkdir -p /home/node/.config /home/node/.ssh && chown -R node:node /home/node
ENV HOME=/home/node

# Create a local tmp directory that isn't /tmp
RUN mkdir -p /usr/src/app/tmp && chown node:node /usr/src/app/tmp
ENV TMPDIR=/usr/src/app/tmp

# --- COPY TOOLS FROM BUILDER STAGE ---
# COPY --from=tools /go/bin/revive /usr/local/bin/
# This puts the pre-built binaries directly into the path
# COPY --from=tools /go/bin/staticcheck /usr/local/bin/
COPY --from=tools /downloads/ktlint /usr/local/bin/
COPY --from=tools /downloads/hadolint /usr/local/bin/
# Copy the checkstyle directory we prepared
COPY --from=tools /downloads/linter-tool-definition-files ./linter-tool-definition-files

# --- NODE BUILD ---
COPY package*.json ./
RUN npm ci

COPY --chown=node:node . .
RUN npm run build

# RUN chown -R node:node /usr/src/app
USER node

# Install Rust for the node user
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/node/.cargo/bin:${PATH}"

# Git config
RUN git config --global user.email "noreply@example.com" \
  && git config --global user.name "JulesMoMoA"

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]