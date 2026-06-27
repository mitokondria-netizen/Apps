# Stage 1: Build the React frontend and bundle the Express server
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist

# Expose port (Cloud Run sets PORT environment variable dynamically)
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Start application using Node
CMD ["node", "dist/server.cjs"]
