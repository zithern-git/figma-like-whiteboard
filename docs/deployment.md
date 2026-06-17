# 部署指南

## 环境要求

### 开发环境
- Node.js >= 18
- MongoDB >= 5.0
- Redis >= 6.0
- npm >= 9

### 生产环境
- Node.js >= 18 LTS
- MongoDB >= 6.0 (推荐副本集)
- Redis >= 6.0 (推荐主从或集群)
- Nginx (反向代理 + 静态文件)
- Docker >= 24 (可选)

## 配置步骤

### 1. 克隆代码

```bash
git clone <repository-url>
cd figma-like-whiteboard
```

### 2. 安装依赖

```bash
# 安装服务端依赖
cd server
npm install

# 安装客户端依赖
cd ../client
npm install
```

### 3. 环境变量配置

#### 服务端 (.env)

```env
# 服务器配置
PORT=3001
NODE_ENV=production

# 数据库
MONGODB_URI=mongodb://localhost:27017/whiteboard

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-strong-secret-key-change-this
JWT_EXPIRES_IN=7d

# 客户端地址
CLIENT_URL=https://your-domain.com

# 文件上传
UPLOAD_DIR=public/uploads
MAX_FILE_SIZE=5242880
```

#### 客户端 (.env.production)

```env
VITE_API_URL=https://api.your-domain.com/api
VITE_WS_URL=https://api.your-domain.com
```

### 4. 构建

```bash
# 构建服务端
cd server
npm run build

# 构建客户端
cd ../client
npm run build
```

### 5. 启动服务

```bash
# 启动服务端
cd server
npm start

# 客户端静态文件由 Nginx 托管
```

## Docker Compose 部署方案

### docker-compose.yml

```yaml
version: '3.8'

services:
  # MongoDB
  mongodb:
    image: mongo:6
    container_name: whiteboard-mongo
    restart: always
    volumes:
      - mongo_data:/data/db
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: your-mongo-password

  # Redis
  redis:
    image: redis:7-alpine
    container_name: whiteboard-redis
    restart: always
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  # 服务端
  server:
    build:
      context: ./server
      dockerfile: Dockerfile
    container_name: whiteboard-server
    restart: always
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - MONGODB_URI=mongodb://admin:your-mongo-password@mongodb:27017/whiteboard?authSource=admin
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - CLIENT_URL=${CLIENT_URL}
    depends_on:
      - mongodb
      - redis
    volumes:
      - uploads:/app/public/uploads

  # Nginx (反向代理 + 静态文件)
  nginx:
    image: nginx:alpine
    container_name: whiteboard-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./client/dist:/usr/share/nginx/html:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - server

volumes:
  mongo_data:
  redis_data:
  uploads:
```

### 服务端 Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
```

### Nginx 配置

```nginx
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server server:3001;
    }

    server {
        listen 80;
        server_name your-domain.com;

        # 静态文件
        location / {
            root /usr/share/nginx/html;
            try_files $uri $uri/ /index.html;
            expires 1d;
        }

        # API 代理
        location /api/ {
            proxy_pass http://backend/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # WebSocket 代理
        location /socket.io/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_read_timeout 86400;
        }

        # 上传文件
        location /uploads/ {
            proxy_pass http://backend;
        }
    }
}
```

## 部署命令

```bash
# 1. 设置环境变量
export JWT_SECRET=$(openssl rand -base64 32)
export CLIENT_URL=https://your-domain.com

# 2. 构建并启动
docker-compose up -d --build

# 3. 查看日志
docker-compose logs -f server

# 4. 停止服务
docker-compose down

# 5. 备份数据
docker-compose exec mongodb mongodump --out /data/backup
docker-compose exec redis redis-cli SAVE
```

## 性能优化

### MongoDB
- 创建索引：`whiteboards.shortId`, `operationLogs.whiteboardId + serverVersion`
- 启用 WiredTiger 缓存

### Redis
- 配置 maxmemory 策略为 allkeys-lru
- 启用持久化 (RDB + AOF)

### Nginx
- 启用 gzip 压缩
- 配置浏览器缓存静态资源
- 使用 HTTP/2

### Node.js
- 使用 PM2 进程管理
- 配置 cluster 模式利用多核

```bash
# PM2 配置
pm2 start dist/index.js -i max --name whiteboard-server
```

## 监控与日志

- 使用 `docker-compose logs` 查看服务日志
- 推荐集成 Prometheus + Grafana 监控
- 配置 MongoDB 慢查询日志
