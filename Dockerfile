FROM node:18-alpine

# Instalar herramientas de compilación necesarias para SQLite
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]