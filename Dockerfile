# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

# Copy frontend package files and install dependencies
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/tmp \
    --mount=type=cache,target=/root/.npm \
    npm ci

# Copy frontend source and build with API URL for container
COPY frontend/ ./
ENV VITE_API_URL=/api/map-data
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runtime

# Set timezone to Philadelphia
ENV TZ=America/New_York
RUN apk add --no-cache tzdata

WORKDIR /app

# Copy backend package files and install production dependencies
COPY backend/package*.json ./
RUN --mount=type=cache,target=/tmp \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Bake a copy of SEPTA's schedule into the image so the server can start
# without SEPTA's download being reachable. It checks for a newer schedule
# shortly after starting and a few times a day after that.
RUN node bin/download-gtfs.js

# Copy built frontend to public directory
COPY --from=frontend-build /app/frontend/dist ./public

# Expose port
EXPOSE 3000

# Run startup script (downloads GTFS data only if the image somehow has none, then starts server)
CMD ["sh", "start.sh"]
