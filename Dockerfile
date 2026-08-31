FROM node:18-alpine

# Instalar herramientas de compilación para SQLite
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

# Forzar la compilación limpia de los módulos nativos
RUN npm install --build-from-source

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]