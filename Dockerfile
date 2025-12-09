FROM node:lts-alpine
WORKDIR /app
COPY . /app
# 之前修正过的安装命令
RUN rm -f package-lock.json \
    ; rm -rf .idea \
    ; rm -rf node_modules \
    && npm install

# --- 插入的新内容 ---
ENV HOST=0.0.0.0
ENV PORT=8080
# ------------------

EXPOSE 8080
CMD ["node", "app.js"]
