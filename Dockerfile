FROM node:lts-alpine
WORKDIR /app

COPY package.json package-lock.json /app/
RUN npm ci --omit=dev

COPY . /app

ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
CMD ["node", "app.js"]
