FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
